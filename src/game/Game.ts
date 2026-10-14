import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { GameLoop } from '../core/GameLoop';
import { dampAngle, wrapAngle } from '../core/math';
import { InputManager } from '../input/InputManager';
import {
  DEFAULT_PLAYER_TUNING,
  createPlayerState,
  updatePlayer,
  type PlayerState,
} from '../player/PlayerController';
import { PlayerView } from '../player/PlayerView';
import { NpcView } from '../characters/NpcView';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { bindResize, createRenderer } from '../render/createRenderer';
import { setupLighting } from '../render/lighting';
import { Hud } from '../ui/Hud';
import { DialogueBox } from '../ui/DialogueBox';
import { InteractionPrompt } from '../ui/InteractionPrompt';
import { World } from '../world/World';
import { PLAYER_START, type LocationId } from '../world/layout';
import { resolveArea } from '../world/areas';
import { StoryState } from '../story/StoryState';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { InteractionMarker } from '../interaction/InteractionMarker';
import { ACTION_LABEL, type Interactable } from '../interaction/types';
import { CHARACTERS, type CharacterId } from '../content/characters';
import { DIALOGUES } from '../content/dialogues';
import { INTERACTABLES, NPCS, npcColliders } from '../content/interactables';
import { currentObjective } from '../content/objectives';
import type { GameEvents } from './events';

/** 会話中のカメラ（相手と自分が斜めに見える構図）。 */
const TALK_CAMERA = { yawOffset: 0.85, pitch: 0.2, distance: 5.2 } as const;
/** 案内表示を出す高さ（住民の頭上）。 */
const NPC_PROMPT_HEIGHT = 2.55;

/**
 * ゲーム全体の組み立てと更新順序の管理。
 *
 * 更新順：入力 → 会話・調査（InteractionSystem） → プレイヤー状態 → 見た目 → カメラ → 描画 → UI。
 * 物語の状態（StoryState）と会話の進行（InteractionSystem）は 3D・DOM に依存せず、
 * ここで view を読んで 3D 表示と UI に反映する。
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  readonly world: World;
  readonly player: PlayerState;
  readonly events = new EventBus<GameEvents>();
  readonly story: StoryState;
  readonly interaction: InteractionSystem;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly input: InputManager;
  private readonly playerView = new PlayerView();
  private readonly npcViews = new Map<string, NpcView>();
  private readonly marker = new InteractionMarker();
  private readonly cameraRig: ThirdPersonCamera;
  private readonly hud: Hud;
  private readonly dialogueBox: DialogueBox;
  private readonly prompt: InteractionPrompt;
  private readonly loop: GameLoop;
  private readonly disposers: Array<() => void> = [];
  private readonly projected = new THREE.Vector3();

  private area: LocationId | null = null;
  /** 会話前のカメラの上下角と距離（会話後に戻す）。 */
  private savedCamera: { pitch: number; distance: number } | null = null;

  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(canvasRoot: HTMLElement, hudRoot: HTMLElement) {
    this.hud = new Hud(hudRoot);
    this.prompt = new InteractionPrompt(hudRoot);
    this.dialogueBox = new DialogueBox(hudRoot, {
      onAdvance: () => this.advanceDialogue(),
      onChoose: (i) => this.interaction.choose(i),
      onHover: (i) => this.interaction.select(i),
    });
    this.renderer = createRenderer(canvasRoot);
    this.disposers.push(bindResize(canvasRoot, this.renderer, this.camera));

    setupLighting(this.scene);
    this.world = new World(npcColliders());
    this.scene.add(this.world.root);
    this.scene.add(this.playerView.root);
    this.scene.add(this.marker.root);
    for (const npc of NPCS) {
      const character = CHARACTERS[npc.character as CharacterId];
      const view = new NpcView(npc, character.appearance, this.world.groundHeight(npc.position.x, npc.position.z));
      this.npcViews.set(npc.id, view);
      this.scene.add(view.root);
    }

    this.story = new StoryState(this.events);
    this.interaction = new InteractionSystem(INTERACTABLES, DIALOGUES, this.story, this.events);
    this.events.on('interactionStarted', ({ id }) => this.onInteractionStarted(id));
    this.events.on('interactionEnded', () => this.onInteractionEnded());
    this.events.on('flagSet', () => this.hud.setObjective(currentObjective(this.story)));
    this.events.on('areaEntered', ({ location }) => {
      this.story.set(`visited:${location}`);
      const label = this.world.locations.find((l) => l.id === location)?.label;
      if (label) this.hud.showArea(label);
    });
    this.hud.setObjective(currentObjective(this.story));

    this.player = createPlayerState(PLAYER_START.position, PLAYER_START.yaw, this.world);
    this.cameraRig = new ThirdPersonCamera(
      this.camera,
      { blockers: this.world.cameraBlockers, groundHeight: (x, z) => this.world.groundHeight(x, z) },
      PLAYER_START.yaw,
    );

    this.input = new InputManager(this.renderer.domElement);
    this.disposers.push(() => this.input.dispose());
    this.loop = new GameLoop((dt) => this.update(dt));
  }

  start(): void {
    this.update(0);
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    for (const d of this.disposers) d();
    this.renderer.dispose();
  }

  get cameraYaw(): number {
    return this.cameraRig.yaw;
  }

  private update(dt: number): void {
    if (this.input.wasPressed('F3')) this.hud.toggleDebug();
    if (this.input.wasPressed('KeyH')) this.hud.toggleHelp();

    // 会話・調査の入力。会話中は移動・視点の入力を止める
    if (this.interaction.isActive) this.handleDialogueInput();
    else if (this.input.wasPressed('KeyE')) this.interaction.interact();
    this.input.enabled = !this.interaction.isActive;

    updatePlayer(this.player, this.input.getMoveIntent(), this.cameraRig.yaw, dt, this.world);
    const partner = this.interaction.partner;
    if (partner) {
      // 会話・調査の相手の方を向く
      const face = Math.atan2(partner.position.x - this.player.x, partner.position.z - this.player.z);
      this.player.heading = dampAngle(this.player.heading, face, 10, dt);
    } else {
      this.interaction.updateTarget(this.player);
    }
    this.updateArea();

    this.playerView.update(this.player, dt, DEFAULT_PLAYER_TUNING.runSpeed);
    for (const [id, view] of this.npcViews) {
      const talking = partner?.id === id;
      view.update(dt, talking ? this.player : null, talking && this.dialogueBox.isRevealing);
    }
    this.cameraRig.update(this.cameraFocus(partner), this.input.consumeOrbitInput(), dt);
    this.updateMarker(dt);

    this.renderer.render(this.scene, this.camera);
    this.updateUi(dt);
    this.input.endFrame();
    this.updateStats(dt);
  }

  private handleDialogueInput(): void {
    const input = this.input;
    const box = this.dialogueBox;
    const choices = box.isRevealing ? 0 : (this.interaction.view?.choices.length ?? 0);
    // 選択肢が出た直後はキーでの決定を受け付けない（文字送りを飛ばすつもりの操作が選択にならないように）
    const decideLocked = choices > 0 && !box.choicesReady;
    if (input.wasPressed('KeyE') || input.wasPressed('Space') || input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) {
      if (!decideLocked) this.confirmDialogue();
      return;
    }
    if (choices === 0) return;
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.interaction.moveSelection(-1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.interaction.moveSelection(1);
    if (decideLocked) return;
    for (let i = 0; i < Math.min(choices, 9); i++) {
      if (input.wasPressed(`Digit${i + 1}`) || input.wasPressed(`Numpad${i + 1}`)) {
        this.interaction.choose(i);
        return;
      }
    }
  }

  /** 決定キー：文字送りの途中なら全文を出し、そうでなければ進める・選ぶ。 */
  private confirmDialogue(): void {
    if (this.dialogueBox.isRevealing) this.dialogueBox.revealAll();
    else this.interaction.confirm();
  }

  /** クリック：文字送りの途中なら全文を出し、そうでなければ送る（選択肢はクリックで選ぶ）。 */
  private advanceDialogue(): void {
    if (this.dialogueBox.isRevealing) this.dialogueBox.revealAll();
    else this.interaction.advance();
  }

  private onInteractionStarted(id: string): void {
    // 歩いていた勢いを止める
    this.player.velocityX = 0;
    this.player.velocityZ = 0;
    this.input.reset();
    this.hud.setDialogueMode(true);

    const partner = this.interaction.partner;
    if (partner?.id !== id || partner.kind !== 'npc') return;
    // 住民との会話は、相手と自分が斜めに見える構図へ寄せる（設計書 L：会話時は人物が見やすい構図へ）
    const orbit = this.cameraRig.orbit;
    this.savedCamera = { pitch: orbit.targetPitch, distance: orbit.targetDistance };
    const toPartner = Math.atan2(partner.position.x - this.player.x, partner.position.z - this.player.z);
    // 今のカメラ位置に近い側から回り込む
    const side = wrapAngle(orbit.yaw - toPartner) >= 0 ? 1 : -1;
    orbit.targetYaw = orbit.yaw + wrapAngle(toPartner + side * TALK_CAMERA.yawOffset - orbit.yaw);
    orbit.targetPitch = TALK_CAMERA.pitch;
    orbit.targetDistance = Math.min(orbit.targetDistance, TALK_CAMERA.distance);
  }

  private onInteractionEnded(): void {
    this.hud.setDialogueMode(false);
    this.dialogueBox.hide();
    if (this.savedCamera) {
      const orbit = this.cameraRig.orbit;
      orbit.targetPitch = this.savedCamera.pitch;
      orbit.targetDistance = this.savedCamera.distance;
      this.savedCamera = null;
    }
  }

  /** 会話中は自分と相手の間を注視する。 */
  private cameraFocus(partner: Interactable | null): { x: number; y: number; z: number } {
    if (!partner || partner.kind !== 'npc') return this.player;
    return {
      x: (this.player.x + partner.position.x) / 2,
      y: this.player.y,
      z: (this.player.z + partner.position.z) / 2,
    };
  }

  private updateArea(): void {
    const next = resolveArea(this.area, this.player, this.world.locations);
    if (next === this.area) return;
    this.area = next;
    if (next) this.events.emit('areaEntered', { location: next });
  }

  private updateMarker(dt: number): void {
    const target = this.interaction.target;
    if (!target) {
      this.marker.hide();
      return;
    }
    const { x, z } = target.position;
    this.marker.show(x, this.world.groundHeight(x, z), z, target.kind === 'npc' ? 1 : 1.25);
    this.marker.update(dt);
  }

  private updateUi(dt: number): void {
    const view = this.interaction.view;
    const partner = this.interaction.partner;
    if (view && partner) {
      const speaker = view.speaker ? CHARACTERS[view.speaker as CharacterId]?.name ?? view.speaker : null;
      this.dialogueBox.show({
        key: `${view.scriptId}:${view.nodeId}:${view.page}`,
        speakerName: speaker,
        ...(partner.kind === 'object' ? { subject: partner.label } : {}),
        text: view.text,
        choices: view.choices.map((c) => c.text),
        selected: this.interaction.selected,
      });
      this.dialogueBox.update(dt);
    } else if (this.dialogueBox.visible) {
      this.dialogueBox.hide();
    }

    const target = this.interaction.target;
    if (!target) {
      this.prompt.hide();
      return;
    }
    const { x, z } = target.position;
    const height = target.kind === 'npc' ? NPC_PROMPT_HEIGHT : target.markerHeight;
    this.projected.set(x, this.world.groundHeight(x, z) + height, z).project(this.camera);
    if (this.projected.z > 1) {
      this.prompt.hide();
      return;
    }
    const canvas = this.renderer.domElement;
    const sx = (this.projected.x * 0.5 + 0.5) * canvas.clientWidth;
    const sy = (-this.projected.y * 0.5 + 0.5) * canvas.clientHeight;
    this.prompt.show(
      { key: target.id, action: ACTION_LABEL[target.kind], label: target.label, done: this.interaction.isCompleted(target) },
      sx,
      sy,
    );
  }

  private updateStats(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (!this.hud.isDebugVisible) return;
    this.hud.updateDebug({
      fps: this.fps,
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      area: this.nearestLocationLabel(),
      drawCalls: this.renderer.info.render.calls,
      target: this.interaction.partner?.label ?? this.interaction.target?.label ?? '-',
      flags: this.story.snapshot(),
    });
  }

  private nearestLocationLabel(): string {
    let best = '-';
    let bestDist = Infinity;
    for (const loc of this.world.locations) {
      const d = Math.hypot(loc.position.x - this.player.x, loc.position.z - this.player.z);
      if (d < bestDist) {
        bestDist = d;
        best = loc.label;
      }
    }
    return `${best}（${bestDist.toFixed(0)}m）`;
  }
}
