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
import { ACTION_LABEL, type Interactable } from '../interaction/types';
import { CHARACTERS, type CharacterId } from '../content/characters';
import { DIALOGUES } from '../content/dialogues';
import { INTERACTABLES, NPCS, npcColliders } from '../content/interactables';
import { currentObjective } from '../content/objectives';
import { HOUSEHOLDS, STORY_DEFS } from '../content/story';
import { LEDGER, LEDGER_NOTE, LEDGER_TITLE } from '../content/ledger';
import { buildLedger, buildNotebook, type JournalSources } from '../journal/models';
import { buildOutcome, buildPlanBoard, describePlan, type PlanSources } from '../journal/planModels';
import { INITIAL_PLAN, OUTCOMES, PLANNING_AVAILABLE, RESPONSE_SUMMARY } from '../content/plan';
import { evaluate } from '../story/conditions';
import { createSave, type SaveFile } from '../save/saveData';
import { SaveStore, browserStorage } from '../save/SaveStore';
import { allowsExploration, nextMode, type UiAction, type UiMode } from './modes';
import type { GameEvents } from './events';

/** 会話中のカメラ（相手と自分が斜めに見える構図）。 */
const TALK_CAMERA = { yawOffset: 0.85, pitch: 0.2, distance: 5.2 } as const;
/** 案内表示を出す高さ（住民の頭上）。 */
const NPC_PROMPT_HEIGHT = 2.55;
const JOURNAL_SOURCES: JournalSources = { characters: CHARACTERS, households: HOUSEHOLDS, planSummaries: RESPONSE_SUMMARY };
const PLAN_SOURCES: PlanSources = {
  ...JOURNAL_SOURCES,
  summaries: RESPONSE_SUMMARY,
  outcomes: OUTCOMES,
  considerationTopics: ['sae.dateReason', 'sae.roof', 'isuke.availability', 'isuke.field', 'isuke.pastHelp'],
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
    this.prompt = new InteractionPrompt(hudRoot);
    this.toasts = new Toasts(hudRoot);
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
      onDecide: () => this.onPlanDecide(),
      onClose: () => this.dispatch('close'),
      onNotebook: () => this.dispatch('openNotebook'),
    });
    this.resultView = new ResultView(hudRoot, () => this.dispatch('close'));
    this.pauseMenu = new MenuPanel(hudRoot, 'pause-layer', (id) => this.onPauseItem(id));
    this.notice = new MenuPanel(hudRoot, 'notice-layer', (id) => this.noticeHandlers[id]?.());

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
    this.events.on('topicLearned', ({ topic, previous }) => {
      refreshObjective();
      const title = STORY_DEFS.topics[topic]?.title ?? topic;
      this.toasts.push('手帳', previous ? `「${title}」を書き足した` : `「${title}」を書き留めた`);
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
    this.events.on('storyRestored', () => {
      refreshObjective();
      this.world.setSaeRoofRenewed(this.story.currentStage('sae.roof') === 'renewed');
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
    if (prev === 'pause') this.pauseMenu.hide();
    if (prev === 'notice') this.notice.hide();

    if (next === 'notebook') this.notebook.show(buildNotebook(this.story, JOURNAL_SOURCES), this.notebookSeenOrder);
    if (next === 'ledger') this.ledger.show(buildLedger(this.story, this.ledgerEntries(), JOURNAL_SOURCES));
    if (next === 'plan') this.planView.show(buildPlanBoard(this.story, PLAN_SOURCES));
    if (next === 'result') {
      const outcome = buildOutcome(this.story, OUTCOMES);
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
          this.dispatch('close');
        }
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
    this.cameraRig.update(this.cameraFocus(partner), this.input.consumeOrbitInput(), dt);
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

  private onInteractionEnded(id: string, cancelled: boolean): void {
    this.hud.setDialogueMode(false);
    this.dialogueBox.hide();
    this.restoreCamera();
    this.dispatch('dialogueEnded');
    // 会話・調査のたびに自動で記録する（中断した場合も、それまでに確定したことを残す）
    this.saveGame();
    const def = INTERACTABLES.find((i) => i.id === id);
    if (!cancelled && def?.kind === 'object' && def.opens === 'ledger') this.dispatch('openLedger');
    if (!cancelled && def?.kind === 'object' && def.opens === 'plan') this.openPlanBoard();
  }

  // ───────── 計画（作業台） ─────────

  /** 作業台を開く。サエから日取りの話を聞くまでは開かない。初めて開いたときはサエの元の案を広げる。 */
  private openPlanBoard(): void {
    const decided = this.story.planPhase() === 'decided';
    if (!decided && !evaluate(PLANNING_AVAILABLE, this.story)) return;
    if (!decided && !this.story.planDraft()) this.story.setPlanDraft(INITIAL_PLAN);
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
    const outcome = this.story.decidePlan({ source: '作業台で決めた' });
    if (!outcome) return;
    this.world.setSaeRoofRenewed(true);
    this.saveGame();
    this.dispatch('openResult');
  }

  /** 結帳に載せる記録（過去の記録＋決めた計画の結果として書き加えられた記録）。 */
  private ledgerEntries() {
    const outcome = this.story.outcome();
    const added = outcome ? OUTCOMES[outcome]?.ledger : undefined;
    return added ? [...LEDGER, added] : LEDGER;
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
    // 位置が歩けない場所（配置変更後の古い記録など）ならスタート地点に戻す
    const { x, z } = save.player;
    const b = this.world.bounds;
    const valid =
      x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && !overlapsAny({ x, z }, DEFAULT_PLAYER_TUNING.radius, this.world.colliders);
    this.placePlayer(valid ? save.player : { ...PLAYER_START.position, heading: PLAYER_START.yaw });
  }

  private resetToNewGame(): void {
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
