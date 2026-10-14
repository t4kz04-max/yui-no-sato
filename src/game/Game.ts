import * as THREE from 'three';
import { GameLoop } from '../core/GameLoop';
import { InputManager } from '../input/InputManager';
import {
  DEFAULT_PLAYER_TUNING,
  createPlayerState,
  updatePlayer,
  type PlayerState,
} from '../player/PlayerController';
import { PlayerView } from '../player/PlayerView';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera';
import { bindResize, createRenderer } from '../render/createRenderer';
import { setupLighting } from '../render/lighting';
import { Hud } from '../ui/Hud';
import { World } from '../world/World';
import { PLAYER_START } from '../world/layout';

/**
 * ゲーム全体の組み立てと更新順序の管理。
 *
 * 更新順：入力 → プレイヤー状態（純粋ロジック） → 見た目への反映 → カメラ → 描画。
 * Phase 1 以降のインタラクション・会話・ゲーム状態はここに系統ごとに追加していく。
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
  readonly world: World;
  readonly player: PlayerState;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly input: InputManager;
  private readonly playerView = new PlayerView();
  private readonly cameraRig: ThirdPersonCamera;
  private readonly hud: Hud;
  private readonly loop: GameLoop;
  private readonly disposers: Array<() => void> = [];

  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  constructor(canvasRoot: HTMLElement, hudRoot: HTMLElement) {
    this.hud = new Hud(hudRoot);
    this.renderer = createRenderer(canvasRoot);
    this.disposers.push(bindResize(canvasRoot, this.renderer, this.camera));

    setupLighting(this.scene);
    this.world = new World();
    this.scene.add(this.world.root);
    this.scene.add(this.playerView.root);

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

    updatePlayer(this.player, this.input.getMoveIntent(), this.cameraRig.yaw, dt, this.world);
    this.playerView.update(this.player, dt, DEFAULT_PLAYER_TUNING.runSpeed);
    this.cameraRig.update(this.player, this.input.consumeOrbitInput(), dt);

    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    this.updateStats(dt);
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
