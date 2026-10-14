import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { GameLoop } from '../core/GameLoop';
import { overlapsAny } from '../core/collision';
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
import { NotebookView, type NotebookTab } from '../ui/NotebookView';
import { LedgerView } from '../ui/LedgerView';
import { MenuPanel, type MenuContent } from '../ui/MenuPanel';
import { Toasts } from '../ui/Toasts';
import { PlanView } from '../ui/PlanView';
import { ResultView } from '../ui/ResultView';
import { World } from '../world/World';
import { PLAYER_START, type LocationId } from '../world/layout';
import { resolveArea } from '../world/areas';
import { StoryState } from '../story/StoryState';
import { CONSENT_LABEL } from '../story/types';
import { InteractionSystem } from '../interaction/InteractionSystem';
import { InteractionMarker } from '../interaction/InteractionMarker';
import { actionLabel, type Interactable } from '../interaction/types';
import { CHARACTERS, VILLAGER_LOOKS, type CharacterId } from '../content/characters';
import { npcStyle, roofDayStage, roofStates } from '../content/staging';
import { RoofDayScene } from '../world/RoofDayScene';
import { southSideOf } from '../world/World';
import { BUILDINGS } from '../world/layout';
import { DIALOGUES } from '../content/dialogues';
import { INTERACTABLES, NPCS, npcColliders } from '../content/interactables';
import { currentObjective } from '../content/objectives';
import { HOUSEHOLDS, STORY_DEFS } from '../content/story';
import { LEDGER_NOTE, LEDGER_TITLE } from '../content/ledger';
import { buildLedger, buildNotebook, type JournalSources } from '../journal/models';
import { buildOutcome, buildPlanBoard, describePlan, shownLines, type PlanSources } from '../journal/planModels';
import {
  ENDINGS,
  INITIAL_PLAN3,
  MEANWHILE,
  RELEVANT_TOPICS3,
  RESPONSE_SUMMARY3,
  act1Summary,
  forecastPlan3,
} from '../content/plan3';
import { EXPLAIN, PROMISES_KEPT_BY_CH3, ledgerEntries } from '../content/chronicle';
import { EndingView, ExplainView, type EndingModel } from '../ui/StoryScreens';
import {
  INITIAL_PLAN,
  OUTCOMES,
  PLANNING_AVAILABLE,
  RELEVANT_TOPICS,
  RESPONSE_SUMMARY,
  forecastPlan,
} from '../content/plan';
import { evaluate, knows } from '../story/conditions';
import { SAE_HOUSE_OPEN } from '../content/house';
import { SAE_INTERIOR, isInsideSaeHouse } from '../world/saeInterior';
import { DEFAULT_ORBIT_LIMITS, INDOOR_ORBIT_LIMITS } from '../camera/orbit';
import { INDOOR_SKY_LIGHT_SCALE } from '../world/builders/interior';
import { createSave, type SaveFile } from '../save/saveData';
import { SaveStore, browserStorage } from '../save/SaveStore';
import { allowsExploration, nextMode, type UiAction, type UiMode } from './modes';
import type { GameEvents } from './events';

/** 会話中のカメラ（相手と自分が斜めに見える構図）。 */
const TALK_CAMERA = { yawOffset: 0.85, pitch: 0.2, distance: 5.2 } as const;
/** 案内表示を出す高さ（住民の頭上）。 */
const NPC_PROMPT_HEIGHT = 2.55;
const JOURNAL_SOURCES: JournalSources = {
  characters: CHARACTERS,
  households: HOUSEHOLDS,
  planSummaries: { ...RESPONSE_SUMMARY, ...RESPONSE_SUMMARY3 },
};
const PLAN_SOURCES: PlanSources = {
  ...JOURNAL_SOURCES,
  plans: {
    roof: {
      summaries: RESPONSE_SUMMARY,
      forecast: forecastPlan,
      relevantTopics: RELEVANT_TOPICS,
      outcomeTitle: (id) => OUTCOMES[id]?.title,
      outcomeTagline: (id) => OUTCOMES[id]?.tagline,
    },
    isukeRoof: {
      summaries: RESPONSE_SUMMARY3,
      forecast: forecastPlan3,
      relevantTopics: RELEVANT_TOPICS3,
      outcomeTitle: (id) => (ENDINGS[id] ? `${ENDINGS[id].code} ${ENDINGS[id].title}` : undefined),
      outcomeTagline: (id) => ENDINGS[id]?.title,
    },
  },
};
const NOTEBOOK_TAB_KEYS: ReadonlyArray<[string, NotebookTab]> = [
  ['Digit1', 'people'],
  ['Digit2', 'known'],
  ['Digit3', 'unconfirmed'],
  ['Digit4', 'promises'],
];

/**
 * ゲーム全体の組み立てと更新順序の管理。
 *
 * 更新順：入力（画面の状態に応じて振り分け） → 会話・調査 → プレイヤー状態 → 見た目 → カメラ → 描画 → UI。
 * 物語の状態（StoryState）・会話の進行（InteractionSystem）・画面の状態遷移（modes.ts）は
 * 3D・DOM に依存せず、ここで状態を読んで 3D 表示と UI に反映する。
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  readonly world: World;
  readonly player: PlayerState;
  readonly events = new EventBus<GameEvents>();
  readonly story: StoryState;
  readonly interaction: InteractionSystem;
  readonly saveStore: SaveStore;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly input: InputManager;
  private readonly playerView = new PlayerView();
  private readonly npcViews = new Map<string, NpcView>();
  private readonly marker = new InteractionMarker();
  private readonly cameraRig: ThirdPersonCamera;
  private readonly hud: Hud;
  private readonly dialogueBox: DialogueBox;
  private readonly prompt: InteractionPrompt;
  private readonly notebook: NotebookView;
  private readonly ledger: LedgerView;
  private readonly planView: PlanView;
  private readonly resultView: ResultView;
  private readonly endingView: EndingView;
  private readonly explainView: ExplainView;
  /** 屋根葺きの日の作業の場（足場・茅の山・手伝いに来た村の人たち）。 */
  private readonly roofDay: RoofDayScene;
  /** 屋外にいたときのカメラの角度と距離（室内から出たら戻す）。 */
  private outdoorCamera: { pitch: number; distance: number } | null = null;
  /** 空の光（屋内では強める）。 */
  private readonly skyLight: THREE.HemisphereLight;
  private readonly skyBase: number;
  /** 出入りの暗転。 */
  private readonly fadeEl: HTMLDivElement;
  /** 会話が終わったら、屋根葺きの日を終えて結果画面を出す。 */
  private endDayAfterDialogue = false;
  private readonly pauseMenu: MenuPanel;
  private readonly notice: MenuPanel;
  private readonly toasts: Toasts;
  private readonly loop: GameLoop;
  private readonly disposers: Array<() => void> = [];
  private readonly projected = new THREE.Vector3();

  private uiMode: UiMode = 'explore';
  private area: LocationId | null = null;
  /** 会話前のカメラの上下角と距離（会話後に戻す）。 */
  private savedCamera: { pitch: number; distance: number } | null = null;
  /** 手帳を最後に閉じた時点の記録の順番（これより新しいものに「新」を付ける）。 */
  private notebookSeenOrder = 0;
  /** お知らせ画面のボタンごとの処理。 */
  private noticeHandlers: Record<string, () => void> = {};

  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(canvasRoot: HTMLElement, hudRoot: HTMLElement) {
    this.hud = new Hud(hudRoot);
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'scene-fade';
    hudRoot.appendChild(this.fadeEl);
    this.prompt = new InteractionPrompt(hudRoot);
    this.toasts = new Toasts(this.hud.rightColumn);
    this.dialogueBox = new DialogueBox(hudRoot, {
      onAdvance: () => this.advanceDialogue(),
      onChoose: (i) => this.interaction.choose(i),
      onHover: (i) => this.interaction.select(i),
    });
    this.notebook = new NotebookView(hudRoot, () => this.dispatch('close'));
    this.ledger = new LedgerView(hudRoot, LEDGER_TITLE, LEDGER_NOTE, {
      onClose: () => this.dispatch('close'),
      onNotebook: () => this.dispatch('openNotebook'),
    });
    this.planView = new PlanView(hudRoot, {
      onSelect: (item, option) => this.onPlanSelect(item, option),
      onPick: (plan) => {
        if (this.uiMode === 'plan') this.story.setPlanDraft(plan);
      },
      onDecide: () => this.onPlanDecide(),
      onClose: () => this.dispatch('close'),
      onNotebook: () => this.dispatch('openNotebook'),
    });
    this.resultView = new ResultView(hudRoot, () => this.onResultClosed());
    this.endingView = new EndingView(hudRoot, { onClose: () => this.dispatch('close'), onExplain: () => this.dispatch('openExplain') });
    this.explainView = new ExplainView(hudRoot, () => this.dispatch('close'));
    this.pauseMenu = new MenuPanel(hudRoot, 'pause-layer', (id) => this.onPauseItem(id));
    this.notice = new MenuPanel(hudRoot, 'notice-layer', (id) => this.noticeHandlers[id]?.());

    this.renderer = createRenderer(canvasRoot);
    this.disposers.push(bindResize(canvasRoot, this.renderer, this.camera));

    const lighting = setupLighting(this.scene);
    this.skyLight = lighting.sky;
    this.skyBase = lighting.sky.intensity;
    this.world = new World({
      npcColliders: npcColliders(),
      horizon: lighting.horizon,
      sunDirection: lighting.sunDirection,
      keepClear: INTERACTABLES.map((i) => i.position),
    });
    this.scene.add(this.world.root);
    this.scene.add(this.playerView.root);
    this.scene.add(this.marker.root);
    const saeDef = BUILDINGS.find((b) => b.id === 'sae')!;
    this.roofDay = new RoofDayScene(
      this.world.palette,
      this.world.buildingRoots.get('sae')!,
      this.world.roofOf('sae')!,
      southSideOf(saeDef.rotation),
      VILLAGER_LOOKS,
      (x, z) => this.world.groundHeight(x, z),
    );
    this.scene.add(this.roofDay.root);
    for (const npc of NPCS) {
      const character = CHARACTERS[npc.character as CharacterId];
      const view = new NpcView(
        npc,
        character.appearance,
        this.world.groundHeight(npc.position.x, npc.position.z),
        character.idle,
      );
      this.npcViews.set(npc.id, view);
      this.scene.add(view.root);
    }

    this.story = new StoryState(STORY_DEFS, this.events);
    this.interaction = new InteractionSystem(INTERACTABLES, DIALOGUES, this.story, this.events);
    this.saveStore = new SaveStore(browserStorage(), STORY_DEFS);
    this.bindEvents();
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
    this.checkSaveOnStart();
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

  get mode(): UiMode {
    return this.uiMode;
  }

  // ───────── イベントの接続 ─────────

  private bindEvents(): void {
    const refreshObjective = () => this.hud.setObjective(currentObjective(this.story));
    this.events.on('interactionStarted', ({ id }) => this.onInteractionStarted(id));
    this.events.on('interactionEnded', ({ id, cancelled }) => this.onInteractionEnded(id, cancelled));
    this.events.on('flagSet', refreshObjective);
    this.events.on('topicLearned', ({ topic, stage, previous }) => {
      refreshObjective();
      // 通知には要点を出す（何が分かったかが一目で分かるように）
      const def = STORY_DEFS.topics[topic];
      const person = def?.person ? `${CHARACTERS[def.person as CharacterId]?.name ?? def.person}：` : '';
      const summary = def?.stages.find((s) => s.id === stage)?.summary ?? def?.title ?? topic;
      this.toasts.push(previous ? '手帳を更新' : '手帳に記録', person + summary);
      this.refreshNotebookBadge();
    });
    this.events.on('consentChanged', ({ npc, request, status }) => {
      const who = CHARACTERS[npc as CharacterId]?.name ?? npc;
      const what = STORY_DEFS.requests[request]?.label ?? request;
      this.toasts.push('意向', `${who}：${what}は「${CONSENT_LABEL[status]}」`);
      this.refreshNotebookBadge();
    });
    this.events.on('promiseRecorded', () => {
      this.toasts.push('約束', '新しい約束を書き留めた');
      this.refreshNotebookBadge();
    });
    const refreshPlan = () => {
      refreshObjective();
      if (this.uiMode === 'plan') this.planView.show(buildPlanBoard(this.story, PLAN_SOURCES));
    };
    this.events.on('planDrafted', refreshPlan);
    this.events.on('planDecided', refreshPlan);
    this.events.on('planResponded', ({ npc, status }) => {
      refreshPlan();
      const who = CHARACTERS[npc as CharacterId]?.name ?? npc;
      this.toasts.push('相談', `${who}：今の案への返事は「${CONSENT_LABEL[status]}」`);
      this.refreshNotebookBadge();
    });
    this.events.on('flagSet', ({ flag }) => {
      if (flag === 'roofDay:ended') this.endDayAfterDialogue = true;
    });
    this.events.on('chapterChanged', () => {
      refreshObjective();
      this.applyChapterToWorld();
    });
    this.events.on('storyRestored', () => {
      refreshObjective();
      this.applyChapterToWorld();
      this.refreshNotebookBadge();
    });
    this.events.on('areaEntered', ({ location }) => {
      this.story.set(`visited:${location}`);
      const label = this.world.locations.find((l) => l.id === location)?.label;
      if (label) this.hud.showArea(label);
    });
  }

  // ───────── 画面の状態 ─────────

  /** 画面の状態を遷移させ、表示を合わせる。 */
  private dispatch(action: UiAction): void {
    const prev = this.uiMode;
    const next = nextMode(prev, action);
    if (next === prev) return;
    this.uiMode = next;
    if (prev === 'notebook') {
      this.notebook.hide();
      this.notebookSeenOrder = buildNotebook(this.story, JOURNAL_SOURCES).latestOrder;
      this.refreshNotebookBadge();
    }
    if (prev === 'ledger') this.ledger.hide();
    if (prev === 'plan') this.planView.hide();
    if (prev === 'result') this.resultView.hide();
    if (prev === 'ending') this.endingView.hide();
    if (prev === 'explain') this.explainView.hide();
    if (prev === 'pause') this.pauseMenu.hide();
    if (prev === 'notice') this.notice.hide();

    if (next === 'notebook') this.notebook.show(buildNotebook(this.story, JOURNAL_SOURCES), this.notebookSeenOrder);
    if (next === 'ledger') this.ledger.show(buildLedger(this.story, ledgerEntries(this.story), JOURNAL_SOURCES));
    if (next === 'ending') this.endingView.show(this.endingModel());
    if (next === 'explain') this.explainView.show(EXPLAIN);
    if (next === 'plan') this.planView.show(buildPlanBoard(this.story, PLAN_SOURCES));
    if (next === 'result') {
      const outcome = buildOutcome(this.story, OUTCOMES, JOURNAL_SOURCES, 'roof');
      if (outcome) this.resultView.show(outcome);
    }
    if (next === 'pause') this.pauseMenu.show(this.pauseContent());
    // お知らせの中身は showNotice で表示する
    this.hud.setOverlayMode(next !== 'explore' && next !== 'dialogue');
    // 画面を切り替えたら、押しっぱなしのキーや溜まった視点操作を捨てる
    this.input.reset();
  }

  private refreshNotebookBadge(): void {
    this.hud.setNotebookBadge(buildNotebook(this.story, JOURNAL_SOURCES).latestOrder > this.notebookSeenOrder);
  }

  // ───────── 毎フレームの更新 ─────────

  private update(dt: number): void {
    if (this.input.wasPressed('F3')) this.hud.toggleDebug();
    if (this.input.wasPressed('KeyH')) this.hud.toggleHelp();

    switch (this.uiMode) {
      case 'explore':
        this.handleExploreInput();
        break;
      case 'dialogue':
        this.handleDialogueInput();
        break;
      case 'notebook':
        this.handleNotebookInput();
        break;
      case 'ledger':
        if (this.input.wasPressed('Escape')) this.dispatch('esc');
        else if (this.input.wasPressed('Tab')) this.dispatch('tab');
        break;
      case 'plan':
        if (this.input.wasPressed('Escape')) this.dispatch('esc');
        else if (this.input.wasPressed('Tab')) this.dispatch('tab');
        break;
      case 'result':
        if (this.input.wasPressed('Escape') || this.input.wasPressed('Enter') || this.input.wasPressed('NumpadEnter')) {
          this.onResultClosed();
        }
        break;
      case 'ending':
        if (this.input.wasPressed('Escape') || this.input.wasPressed('Enter') || this.input.wasPressed('NumpadEnter')) {
          this.dispatch('close');
        }
        break;
      case 'explain':
        if (this.input.wasPressed('Escape')) this.dispatch('esc');
        break;
      case 'pause':
        if (this.input.wasPressed('Escape')) this.dispatch('esc');
        else this.handleMenuInput(this.pauseMenu);
        break;
      case 'notice':
        this.handleMenuInput(this.notice);
        break;
    }
    this.input.enabled = allowsExploration(this.uiMode);

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
    // 屋根葺きの日：茅を運ぶ人が動いたら、当たり判定を付け直す
    if (this.roofDay.update(dt, this.player)) this.world.setExtraColliders(this.roofDay.colliders());
    this.cameraRig.update(this.cameraFocus(partner), this.input.consumeOrbitInput(), dt);
    // 室内の壁際などでカメラがすぐ後ろまで寄ったときは、主人公を隠して視界をふさがない
    this.playerView.root.visible = this.cameraRig.currentDistance > 1.25;
    this.updateMarker(dt);

    this.renderer.render(this.scene, this.camera);
    this.updateUi(dt);
    this.input.endFrame();
    this.updateStats(dt);
  }

  private handleExploreInput(): void {
    const input = this.input;
    if (input.wasPressed('Escape')) this.dispatch('esc');
    else if (input.wasPressed('Tab')) this.dispatch('tab');
    else if (input.wasPressed('KeyE')) this.interaction.interact();
  }

  private handleDialogueInput(): void {
    const input = this.input;
    // Esc：会話・調査を中断する。それまでに確定した選択・得た情報は取り消さない
    if (input.wasPressed('Escape')) {
      this.interaction.cancel();
      return;
    }
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

  private handleNotebookInput(): void {
    const input = this.input;
    if (input.wasPressed('Escape')) return this.dispatch('esc');
    if (input.wasPressed('Tab')) return this.dispatch('tab');
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA') || input.wasPressed('KeyQ')) this.notebook.moveTab(-1);
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD') || input.wasPressed('KeyE')) this.notebook.moveTab(1);
    for (const [key, tab] of NOTEBOOK_TAB_KEYS) if (input.wasPressed(key)) this.notebook.setTab(tab);
  }

  private handleMenuInput(menu: MenuPanel): void {
    const input = this.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW') || input.wasPressed('ArrowLeft')) menu.moveSelection(-1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS') || input.wasPressed('ArrowRight')) menu.moveSelection(1);
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || input.wasPressed('Space') || input.wasPressed('KeyE')) {
      menu.activate();
    }
  }

  // ───────── 会話・調査 ─────────

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
    this.dispatch('dialogueStarted');
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

  // ───────── サエ家の出入り（Phase 5.5） ─────────

  /** 入口で E：許しがあれば室内へ。 */
  private enterSaeHouse(): void {
    this.setIndoorMode(true);
    const e = SAE_INTERIOR.entry;
    this.placePlayerInPlace(e);
    this.flashFade();
  }

  /** 室内の入口で E：外へ。 */
  private leaveSaeHouse(): void {
    this.setIndoorMode(false);
    this.placePlayerInPlace(SAE_INTERIOR.exit);
    this.flashFade();
  }

  /** 屋内・屋外を切り替える（当たり判定・カメラの遮蔽物・調べられる物・カメラの範囲・室内の明かり）。 */
  private setIndoorMode(indoor: boolean): void {
    if (this.world.indoor === indoor) return;
    this.world.setIndoor(indoor);
    this.interaction.setIndoor(indoor);
    this.skyLight.intensity = this.skyBase * (indoor ? INDOOR_SKY_LIGHT_SCALE : 1);
    const orbit = this.cameraRig.orbit;
    if (indoor) {
      this.outdoorCamera = { pitch: orbit.targetPitch, distance: orbit.targetDistance };
      this.cameraRig.limits = INDOOR_ORBIT_LIMITS;
      orbit.targetPitch = orbit.pitch = 0.42;
      orbit.targetDistance = orbit.distance = 3.8;
    } else {
      this.cameraRig.limits = DEFAULT_ORBIT_LIMITS;
      orbit.targetPitch = orbit.pitch = this.outdoorCamera?.pitch ?? 0.42;
      orbit.targetDistance = orbit.distance = this.outdoorCamera?.distance ?? 10;
      this.outdoorCamera = null;
    }
  }

  /** 出入りのときの位置合わせ（章の移動ではないので、屋内・屋外は切り替えない）。 */
  private placePlayerInPlace(p: { readonly x: number; readonly z: number; readonly heading: number }): void {
    Object.assign(this.player, { x: p.x, z: p.z, heading: p.heading, velocityX: 0, velocityZ: 0 });
    this.player.y = this.world.groundHeight(p.x, p.z);
    this.cameraRig.reset(p.heading);
  }

  /** 出入りの短い暗転（黒から明けるだけ。操作は止めない）。 */
  private flashFade(): void {
    const el = this.fadeEl;
    el.style.transition = 'none';
    el.style.opacity = '1';
    void el.offsetWidth;
    el.style.transition = 'opacity 0.45s ease-out';
    el.style.opacity = '0';
  }

  private onInteractionEnded(id: string, cancelled: boolean): void {
    this.hud.setDialogueMode(false);
    this.dialogueBox.hide();
    this.restoreCamera();
    this.dispatch('dialogueEnded');
    const def = INTERACTABLES.find((i) => i.id === id);
    // サエ家の出入り（記録より先に移る：記録した位置と屋内・屋外が食い違わないように）
    if (!cancelled && def?.kind === 'object' && def.opens === 'enterHouse' && evaluate(SAE_HOUSE_OPEN, this.story)) this.enterSaeHouse();
    if (!cancelled && def?.kind === 'object' && def.opens === 'leaveHouse') this.leaveSaeHouse();
    // 会話・調査のたびに自動で記録する（中断した場合も、それまでに確定したことを残す）
    this.saveGame();
    if (!cancelled && def?.kind === 'object' && def.opens === 'ledger') this.dispatch('openLedger');
    if (!cancelled && def?.kind === 'object' && def.opens === 'plan') this.openPlanBoard();
    // サエと話して屋根葺きの日を終えた → 結果画面
    if (this.endDayAfterDialogue) {
      this.endDayAfterDialogue = false;
      this.dispatch('openResult');
    }
  }

  // ───────── 計画（作業台） ─────────

  /** 作業台を開く。サエから日取りの話を聞くまでは開かない。初めて開いたときはサエの元の案を広げる。 */
  private openPlanBoard(): void {
    const planId = this.story.activePlanId();
    if (!planId) return;
    const decided = this.story.planPhase() === 'decided';
    const available = planId === 'roof' ? evaluate(PLANNING_AVAILABLE, this.story) : evaluate(knows('isuke.roof3'), this.story);
    if (!decided && !available) return;
    if (!decided && !this.story.planDraft()) this.story.setPlanDraft(planId === 'roof' ? INITIAL_PLAN : INITIAL_PLAN3);
    this.dispatch('openPlan');
  }

  private onPlanSelect(item: string, option: string): void {
    const draft = this.story.planDraft();
    if (!draft || this.uiMode !== 'plan') return;
    this.story.setPlanDraft({ ...draft, [item]: option });
  }

  private onPlanDecide(): void {
    const draft = this.story.planDraft();
    if (this.story.planPhase() !== 'ready' || !draft) return;
    this.showNotice(
      {
        title: 'この段取りで決めますか？',
        body: `${describePlan(this.story, draft)}
決めた後は変えられません。`,
        items: [
          { id: 'no', label: 'もう少し考える' },
          { id: 'yes', label: 'この段取りで決める' },
        ],
        defaultId: 'no',
      },
      { no: () => this.dispatch('openPlan'), yes: () => this.decidePlan() },
    );
  }

  private decidePlan(): void {
    const planId = this.story.activePlanId();
    const outcome = this.story.decidePlan({ source: '作業台で決めた' });
    if (!outcome) return;
    this.saveGame();
    if (planId === 'roof') {
      // 屋根葺き当日へ（章は決定の効果で進んでいる）
      this.placePlayerAt({ x: 1.5, z: 15.5, heading: Math.PI });
      this.showNotice(
        {
          title: '屋根葺きの日',
          body: '決めた段取りで、屋根葺きの日が来た。\n村を歩いて、誰がどこで何をしているか見て回ろう。サエと話すと一日を終えられる。',
          items: [{ id: 'ok', label: '村に出る' }],
        },
        { ok: () => undefined },
      );
    } else {
      this.dispatch('openEnding');
    }
  }

  /** 結果画面を閉じたとき。屋根葺きの日の結果なら、三年後（第3幕）へ進む。 */
  private onResultClosed(): void {
    this.dispatch('close');
    if (this.story.chapter !== 'roofDay') return;
    const meanwhile = shownLines(this.story, MEANWHILE).join('\n');
    this.showNotice(
      {
        title: 'それから三年後の秋',
        body: `${meanwhile}\n今度は、伊助家の屋根を葺き替える時が来た。`,
        items: [{ id: 'ok', label: '村に出る' }],
      },
      { ok: () => this.enterChapter3() },
    );
  }

  private enterChapter3(): void {
    for (const id of PROMISES_KEPT_BY_CH3) {
      if (this.story.allPromises().some((p) => p.id === id)) this.story.set(`kept:${id}`);
    }
    this.story.setChapter('ch3');
    this.placePlayerAt({ x: 0, z: 26, heading: Math.PI });
    this.saveGame();
  }

  private endingModel(): EndingModel {
    const decision = this.story.planDecision('isukeRoof');
    const ending = decision ? ENDINGS[decision.outcome] : undefined;
    const roof = this.story.planDecision('roof');
    const added = ledgerEntries(this.story).filter((e) => e.id === 'L3' || e.id === 'L4');
    const name = (h: string) => HOUSEHOLDS[h]?.name ?? h;
    return {
      code: ending?.code ?? '',
      title: ending?.title ?? '',
      story: ending ? [...shownLines(this.story, MEANWHILE), ...shownLines(this.story, ending.story)] : [],
      choices: [
        { label: '第1幕', text: act1Summary(roof?.outcome) },
        { label: '第3幕', text: decision ? describePlan(this.story, decision.plan, 'isukeRoof') : '—' },
      ],
      records: added.flatMap((e) =>
        e.items.map((i) => `${e.when}：${name(i.from)} → ${name(i.to)}　${i.detail}（${i.settlement === 'settled' ? '返し 済' : i.settlement === 'open' ? '返し まだ' : '取り決めなし'}）`),
      ),
    };
  }

  /**
   * 決めた計画の結果を村の様子に反映する（屋根の見た目・はさ掛け・住民の立ち位置と立ち姿・
   * 屋根葺きの日の作業の場・当たり判定）。決定前・やり直しのときは元の様子に戻す。
   * 何をどう見せるかは content/staging.ts の純粋関数で決め、ここでは当てはめるだけにする。
   */
  private applyChapterToWorld(): void {
    const chapter = this.story.chapter;
    const roof = this.story.planDecision('roof');
    const isukeRoof = this.story.planDecision('isukeRoof');
    const def = chapter === 'roofDay' && roof ? OUTCOMES[roof.outcome] : undefined;
    const roofs = roofStates(chapter, roof?.outcome, isukeRoof?.outcome);
    this.world.setRoofState('sae', roofs.sae);
    this.world.setRoofState('isuke', roofs.isuke);
    this.world.setHarvestDone(def?.harvestDone ?? false);
    this.roofDay.show(chapter === 'roofDay' && roof ? roofDayStage(roof.outcome) : null);
    for (const npc of NPCS) {
      const placement = def?.placements[npc.character] ?? null;
      this.interaction.setPlacement(npc.id, placement);
      const p = placement ?? { position: npc.position, heading: npc.heading };
      const view = this.npcViews.get(npc.id);
      view?.setHome(p.position.x, p.position.z, p.heading, this.world.groundHeight(p.position.x, p.position.z));
      const character = npc.character as CharacterId;
      view?.setStyle(npcStyle(character, CHARACTERS[character].idle, chapter, roof?.outcome));
    }
    this.world.setNpcColliders(npcColliders(this.interaction.interactables.filter((i) => i.kind === 'npc')));
    this.world.setExtraColliders(this.roofDay.colliders());
  }

  /** 章が変わったときなど、決まった場所にプレイヤーを置き直す。 */
  private placePlayerAt(p: { x: number; z: number; heading: number }): void {
    // 章が進むときは、屋外の決まった場所に置き直す
    this.setIndoorMode(false);
    Object.assign(this.player, { x: p.x, z: p.z, heading: p.heading, velocityX: 0, velocityZ: 0 });
    this.player.y = this.world.groundHeight(p.x, p.z);
    this.cameraRig.reset(p.heading);
  }

  private restoreCamera(): void {
    if (!this.savedCamera) return;
    const orbit = this.cameraRig.orbit;
    orbit.targetPitch = this.savedCamera.pitch;
    orbit.targetDistance = this.savedCamera.distance;
    this.savedCamera = null;
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

  // ───────── 記録（セーブ・ロード） ─────────

  /** 現在の状態を記録する。会話中は呼ばない（会話の途中の状態を残さない）。 */
  saveGame(): boolean {
    if (this.interaction.isActive) return false;
    return this.saveStore.save(createSave(this.story.snapshot(), this.player));
  }

  private checkSaveOnStart(): void {
    const result = this.saveStore.load();
    if (result.ok) {
      const when = new Date(result.save.savedAt);
      this.showNotice(
        {
          title: '前回の記録があります',
          body: `記録した日時：${Number.isNaN(when.getTime()) ? '不明' : when.toLocaleString('ja-JP')}`,
          items: [
            { id: 'continue', label: '続きから' },
            { id: 'new', label: '最初から（記録は次の自動記録で上書きされます）' },
          ],
          defaultId: 'continue',
        },
        { continue: () => this.applySave(result.save), new: () => this.resetToNewGame() },
      );
    } else if (result.reason === 'corrupt' || result.reason === 'unsupported') {
      this.showNotice(
        {
          title: '記録を読み込めませんでした',
          body:
            (result.reason === 'corrupt' ? '保存されていた記録が壊れていました。' : 'この版では読めない記録でした。') +
            '最初から始めます。読めなかった記録は消さずに別名で残してあります。',
          items: [{ id: 'ok', label: '最初から始める' }],
        },
        { ok: () => undefined },
      );
    } else if (result.reason === 'unavailable') {
      this.toasts.push('記録', 'この環境では進み具合を記録できません');
    }
  }

  private pauseContent(status = ''): MenuContent {
    return {
      title: 'ポーズ',
      items: [
        { id: 'resume', label: '再開する［Esc］' },
        { id: 'notebook', label: '手帳を開く［Tab］' },
        { id: 'save', label: '記録する' },
        { id: 'load', label: '最後の記録から再開する' },
        { id: 'explain', label: '史実と創作について' },
        { id: 'new', label: '最初からやり直す' },
      ],
      defaultId: 'resume',
      status: status || '会話や調査を終えるたびに、自動で記録されます。',
    };
  }

  private onPauseItem(id: string): void {
    switch (id) {
      case 'resume':
        return this.dispatch('close');
      case 'notebook':
        return this.dispatch('openNotebook');
      case 'explain':
        return this.dispatch('openExplain');
      case 'save': {
        const ok = this.saveGame();
        const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        this.pauseMenu.setStatus(ok ? `記録しました（${time}）` : '記録できませんでした（保存領域を使えません）');
        return;
      }
      case 'load':
        return this.showNotice(
          {
            title: '最後の記録から再開しますか？',
            body: '最後に記録した時点に戻ります。それ以降の進み具合は失われます。',
            items: [
              { id: 'no', label: 'やめる' },
              { id: 'yes', label: '再開する' },
            ],
            defaultId: 'no',
          },
          { no: () => undefined, yes: () => this.loadFromStore() },
        );
      case 'new':
        return this.showNotice(
          {
            title: '最初からやり直しますか？',
            body: '今の進み具合は失われます（記録は、次に自動で記録されるときに上書きされます）。',
            items: [
              { id: 'no', label: 'やめる' },
              { id: 'yes', label: '最初からやり直す' },
            ],
            defaultId: 'no',
          },
          { no: () => undefined, yes: () => this.resetToNewGame() },
        );
    }
  }

  private loadFromStore(): void {
    const result = this.saveStore.load();
    if (result.ok) {
      this.applySave(result.save);
      if (result.warnings.length > 0) console.warn('記録の読込で補正した項目', result.warnings);
      this.toasts.push('記録', '最後の記録から再開しました');
    } else {
      this.toasts.push('記録', result.reason === 'empty' ? '記録がまだありません' : '記録を読み込めませんでした');
    }
  }

  /** お知らせ画面を出す。どのボタンでも閉じてから処理する（抜け出せない状態を作らない）。 */
  private showNotice(content: MenuContent, handlers: Record<string, () => void>): void {
    this.dispatch('openNotice');
    if (this.uiMode !== 'notice') return;
    this.noticeHandlers = Object.fromEntries(
      Object.entries(handlers).map(([id, fn]) => [
        id,
        () => {
          this.noticeHandlers = {};
          this.dispatch('close');
          fn();
        },
      ]),
    );
    this.notice.show(content);
  }

  private applySave(save: SaveFile): void {
    this.story.restore(save.story);
    // 室内で記録していたら、室内から再開する（当たり判定も室内のものにしてから位置を確かめる）
    this.setIndoorMode(isInsideSaeHouse(save.player.x, save.player.z));
    // 位置が歩けない場所（配置変更後の古い記録など）ならスタート地点に戻す
    const { x, z } = save.player;
    const b = this.world.bounds;
    const valid =
      x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && !overlapsAny({ x, z }, DEFAULT_PLAYER_TUNING.radius, this.world.colliders);
    this.placePlayer(valid ? save.player : { ...PLAYER_START.position, heading: PLAYER_START.yaw });
  }

  private resetToNewGame(): void {
    this.setIndoorMode(false);
    this.story.restore();
    this.placePlayer({ ...PLAYER_START.position, heading: PLAYER_START.yaw });
  }

  private placePlayer(p: { x: number; z: number; heading: number }): void {
    Object.assign(this.player, { x: p.x, z: p.z, heading: p.heading, velocityX: 0, velocityZ: 0 });
    this.player.y = this.world.groundHeight(p.x, p.z);
    this.cameraRig.reset(p.heading);
    this.area = null;
    this.toasts.clear();
    this.notebookSeenOrder = buildNotebook(this.story, JOURNAL_SOURCES).latestOrder;
    this.refreshNotebookBadge();
  }

  // ───────── 表示 ─────────

  private updateArea(): void {
    const next = resolveArea(this.area, this.player, this.world.locations);
    if (next === this.area) return;
    this.area = next;
    if (next) this.events.emit('areaEntered', { location: next });
  }

  private updateMarker(dt: number): void {
    const target = this.uiMode === 'explore' ? this.interaction.target : null;
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

    const target = this.uiMode === 'explore' ? this.interaction.target : null;
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
      { key: target.id, action: actionLabel(target), label: target.label, done: this.interaction.isCompleted(target) },
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
      mode: this.uiMode,
      flags: this.story.flagList(),
      learned: this.story.allLearned().map((l) => `${l.topic}/${l.stage}`),
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
