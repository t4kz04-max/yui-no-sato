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
import { DEFAULT_ORBIT_LIMITS, INDOOR_FRAMING, INDOOR_ORBIT_LIMITS, OUTDOOR_FRAMING, WORKSHOP_ORBIT_LIMITS, orbitSettingsFor } from '../camera/orbit';
import { INDOOR_SKY_LIGHT_SCALE } from '../world/builders/interior';
import { createSave, type SaveFile } from '../save/saveData';
import { SaveStore, browserStorage, type LoadResult } from '../save/SaveStore';
import { RETURN_ACTION, allowsExploration, nextMode, type UiAction, type UiMode } from './modes';
import type { GameEvents } from './events';
import { AudioEngine, type UiSound } from '../audio/AudioEngine';
import { ambientMix, duckFactor, footstepSurface, musicMood, workSound } from '../audio/mix';
import { CHARS_PER_SECOND, SettingsStore, effectiveVolumes, type Settings } from '../settings/settings';
import { selectHint, type HintId } from './hints';
import { TitleScreen } from '../ui/TitleScreen';
import { SettingsView } from '../ui/SettingsView';
import { HistoryView } from '../ui/HistoryView';
import { TransitionView, type TransitionContent } from '../ui/TransitionView';
import { SpeechBubble } from '../ui/SpeechBubble';
import { NameTags } from '../ui/NameTags';
import { buildHistory, type HistorySources } from '../journal/historyModel';
import { unlockedOptions } from '../journal/planModels';
import { roofDayArrival, roofDayBarks, roofDayProgress, roofDayWork } from '../content/staging';
import { glancePlan } from '../content/plan';
import { glancePlan3 } from '../content/plan3';
import { isInsideWorkshop } from '../world/workshop';
import { CHAPTER_LABEL } from '../story/types';

/** 会話中のカメラ（相手と自分が斜めに見える構図）。注視点は顔の高さ。 */
const TALK_CAMERA = { yawOffset: 0.85, pitch: 0.2, distance: 5.2, lookHeight: 1.55 } as const;
/** 屋外の注視点の高さ（屋根まで入れるため高め。Phase 6）。 */
const OUTDOOR_LOOK_HEIGHT = 2.3;
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
      glance: glancePlan,
      relevantTopics: RELEVANT_TOPICS,
      outcomeTitle: (id) => OUTCOMES[id]?.title,
      outcomeTagline: (id) => OUTCOMES[id]?.tagline,
    },
    isukeRoof: {
      summaries: RESPONSE_SUMMARY3,
      forecast: forecastPlan3,
      glance: glancePlan3,
      relevantTopics: RELEVANT_TOPICS3,
      outcomeTitle: (id) => (ENDINGS[id] ? `${ENDINGS[id].code} ${ENDINGS[id].title}` : undefined),
      outcomeTagline: (id) => ENDINGS[id]?.title,
    },
  },
};
/** 選んだことの記録（Phase 6）。結果は実際に起きたこと（作業の日を終えた後）だけを出す。 */
const HISTORY_SOURCES: HistorySources = {
  ...JOURNAL_SOURCES,
  actLabel: { roof: '第1幕　サエ家の屋根葺き', isukeRoof: '第3幕　伊助家の屋根葺き' },
  relevantTopics: { roof: RELEVANT_TOPICS, isukeRoof: RELEVANT_TOPICS3 },
  tagline: (planId, id) => (planId === 'roof' ? OUTCOMES[id]?.tagline : ENDINGS[id] ? `${ENDINGS[id].code} ${ENDINGS[id].title}` : undefined),
  result: (planId, id, story) => {
    if (planId === 'roof') {
      // 屋根葺きの日を終えるまでは、結果はまだ分からない
      if (story.chapter === 'roofDay' && !story.has('roofDay:ended')) return null;
      const o = buildOutcome(story, OUTCOMES, JOURNAL_SOURCES, 'roof');
      return o ? { title: o.title, achieved: o.achieved, remains: o.costs } : null;
    }
    const e = ENDINGS[id];
    return e ? { title: `${e.code} ${e.title}`, achieved: shownLines(story, e.achieved), remains: shownLines(story, e.remains) } : null;
  },
};
/** タイトル画面の背景：村の広場の上からゆっくり見回す。 */
const TITLE_CAMERA = { focus: { x: 0, y: 2, z: 16 }, pitch: 0.3, distance: 21, turnSpeed: 0.04 } as const;
/** 屋根葺きの日に着いたときの短い見渡し（サエ家の南面。数秒・飛ばせる）。 */
const ROOF_DAY_SHOT = { focus: { x: 0, y: 3, z: 14 }, yaw: Math.PI, pitch: 0.24, distance: 20, seconds: 4.5 } as const;
/** 屋根葺きの日の作業の場（サエ家の南面の前。作業の音の聞こえ方に使う）。 */
const ROOF_DAY_SITE = { x: 0, z: 8 } as const;
/** 住民のひと言：聞こえる距離・一人あたりの間隔・全体の間隔・表示の長さ（秒）。 */
const BARK = { range: 4.5, roofRange: 9, cooldown: 28, gap: 7, duration: 3.6 } as const;
/** 住民の頭上の名前を出す距離（Phase 6.5）。 */
const NAME_TAG = { near: 6, far: 16 } as const;
/** 新しく始めたときの導入（物語の情報は、会話で知ることだけにする）。 */
const OPENING: TransitionContent = {
  kicker: '第1幕',
  title: '屋根葺きを控えた秋',
  lines: [
    '合掌造りの家が並ぶ、山あいの小さな村（架空の村）。',
    '世話役の宗平さんから、サエ家の屋根葺きの相談役を頼まれた。',
    '誰かに命令できるわけではない。まずは村を歩いて、みんなの事情を聞いてみよう。',
  ],
  button: '村に出る',
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
  /** 画角 55°（Phase 6 で 50° から広げ、合掌造りの屋根が入りやすくした）。 */
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
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
  /** 宗平の作業場の中にいるか（カメラの範囲を切り替える。Phase 6.5）と、入る前のカメラ。 */
  private inWorkshop = false;
  private workshopSavedCamera: { pitch: number; distance: number } | null = null;
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
  private savedCamera: { pitch: number; distance: number; lookHeight: number } | null = null;
  /** 手帳を最後に閉じた時点の記録の順番（これより新しいものに「新」を付ける）。 */
  private notebookSeenOrder = 0;
  /** お知らせ画面のボタンごとの処理。 */
  private noticeHandlers: Record<string, () => void> = {};

  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 0;

  // ───────── Phase 6：タイトル・設定・音・手引き・演出 ─────────
  readonly settingsStore: SettingsStore;
  readonly audio = new AudioEngine();
  private readonly titleScreen: TitleScreen;
  private readonly settingsView: SettingsView;
  private readonly historyView: HistoryView;
  private readonly transitionView: TransitionView;
  private readonly bubble: SpeechBubble;
  private readonly nameTags: NameTags;
  /** 設定・記録・解説を閉じたときに戻る画面（タイトル・ポーズ・結果・エンディング）。 */
  private returnTo: UiMode | null = null;
  /** タイトル画面で読んだ前回の記録。 */
  private titleSave: LoadResult | null = null;
  /** 時間経過の画面を閉じたときの処理。 */
  private afterTransition: (() => void) | null = null;
  /** 計画を決めた瞬間は、手帳・意向・約束の通知を出さない（決定の知らせにまとめる）。 */
  private quietNotices = false;
  /** 作業台で考えられる選択肢（発見で増えたら知らせる）。 */
  private knownOptions = new Set<string>();
  /** 屋根葺きの日に着いてからの時間（作業の進み具合）。 */
  private roofDayElapsed = 0;
  /** 短いカメラ演出の残り時間。 */
  /** 短いカメラ演出が終わる時刻（実時間。描画が重くてもフレームの数に左右されないように）。 */
  private cinematicEnd = 0;
  /** 探索した時間と、手引きの判定に使う操作の量。 */
  private exploreTime = 0;
  private movedTime = 0;
  private lookedAmount = 0;
  /** 住民のひと言：表示中の話し手・残り時間・話し手ごとの最後の時刻。 */
  private bark: { key: string; name: string | null; text: string; time: number; at: () => { x: number; y: number; z: number } | null } | null = null;
  private barkGap = 0;
  private readonly barkLast = new Map<string, number>();
  private readonly barkCount = new Map<string, number>();
  private clock = 0;
  private lastDialogueKey = '';

  constructor(canvasRoot: HTMLElement, hudRoot: HTMLElement) {
    this.hud = new Hud(hudRoot);
    this.settingsStore = new SettingsStore(browserStorage());
    this.fadeEl = document.createElement('div');
    this.fadeEl.className = 'scene-fade';
    hudRoot.appendChild(this.fadeEl);
    this.prompt = new InteractionPrompt(hudRoot);
    this.toasts = new Toasts(this.hud.rightColumn);
    this.dialogueBox = new DialogueBox(hudRoot, {
      onAdvance: () => this.advanceDialogue(),
      onChoose: (i) => {
        this.sound('confirm');
        this.interaction.choose(i);
      },
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
    this.resultView = new ResultView(
      hudRoot,
      () => this.onResultClosed(),
      () => this.openSubScreen('openHistory'),
    );
    this.endingView = new EndingView(hudRoot, {
      onClose: () => this.dispatch('close'),
      onExplain: () => this.openSubScreen('openExplain'),
      onHistory: () => this.openSubScreen('openHistory'),
    });
    this.explainView = new ExplainView(hudRoot, () => this.closeSubScreen());
    this.historyView = new HistoryView(hudRoot, () => this.closeSubScreen());
    this.settingsView = new SettingsView(hudRoot, {
      onChange: (patch) => this.changeSettings(patch),
      onClose: () => this.closeSubScreen(),
      onMove: () => this.sound('move'),
    });
    this.pauseMenu = new MenuPanel(hudRoot, 'pause-layer', (id) => this.onPauseItem(id), () => this.sound('move'));
    this.notice = new MenuPanel(hudRoot, 'notice-layer', (id) => this.noticeHandlers[id]?.(), () => this.sound('move'));
    this.titleScreen = new TitleScreen(hudRoot, (id) => this.onTitleItem(id), () => this.sound('move'));
    this.transitionView = new TransitionView(hudRoot, () => this.finishTransition());
    this.bubble = new SpeechBubble(hudRoot);
    this.nameTags = new NameTags(hudRoot);

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

    // 音は、ユーザーの操作（クリック・キー）があってから鳴らし始める（ブラウザの自動再生の制限）
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    this.disposers.push(() => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    });
    this.applySettings(this.settingsStore.value);
    this.knownOptions = unlockedOptions(this.story);
    this.showTitle();
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
      this.refreshNotebookBadge();
      if (this.quietNotices) return;
      // 通知には要点を出す（何が分かったかが一目で分かるように）
      const def = STORY_DEFS.topics[topic];
      const person = def?.person ? `${CHARACTERS[def.person as CharacterId]?.name ?? def.person}：` : '';
      const summary = def?.stages.find((s) => s.id === stage)?.summary ?? def?.title ?? topic;
      this.toasts.push(previous ? '手帳を更新' : '手帳に記録', person + summary);
      // その発見で作業台の選択肢が増えたら、意味を一行で添える（どの案かは作業台で確かめる）
      const options = unlockedOptions(this.story);
      const added = [...options].some((o) => !this.knownOptions.has(o));
      this.knownOptions = options;
      if (added && this.story.planPhase() !== 'decided') {
        this.toasts.push('作業台', '考えられる案が増えた（作業台で確かめられる）');
        this.sound('discover');
      } else this.sound('notebook');
    });
    this.events.on('consentChanged', ({ npc, request, status }) => {
      this.refreshNotebookBadge();
      if (this.quietNotices) return;
      const who = CHARACTERS[npc as CharacterId]?.name ?? npc;
      const what = STORY_DEFS.requests[request]?.label ?? request;
      this.toasts.push('意向', `${who}：${what}は「${CONSENT_LABEL[status]}」`);
    });
    this.events.on('promiseRecorded', () => {
      this.refreshNotebookBadge();
      if (this.quietNotices) return;
      this.toasts.push('約束', '新しい約束を書き留めた');
      this.sound('promise');
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
      this.sound('notebook');
    });
    this.events.on('flagSet', ({ flag }) => {
      if (flag === 'roofDay:ended') this.endDayAfterDialogue = true;
    });
    this.events.on('chapterChanged', () => {
      refreshObjective();
      this.knownOptions = unlockedOptions(this.story);
      this.roofDayElapsed = 0;
      this.applyChapterToWorld();
    });
    this.events.on('storyRestored', () => {
      refreshObjective();
      this.knownOptions = unlockedOptions(this.story);
      this.roofDayElapsed = 0;
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
    if (prev === 'title') this.titleScreen.hide();
    if (prev === 'settings') this.settingsView.hide();
    if (prev === 'history') this.historyView.hide();
    if (prev === 'transition') this.transitionView.hide();
    if (prev === 'cinematic') this.endCinematic();

    if (next === 'notebook') {
      this.notebook.show(buildNotebook(this.story, JOURNAL_SOURCES), this.notebookSeenOrder);
      this.markHint('notebook');
    }
    if (next === 'ledger') this.ledger.show(buildLedger(this.story, ledgerEntries(this.story), JOURNAL_SOURCES));
    if (next === 'ending') this.endingView.show(this.endingModel());
    if (next === 'explain') this.explainView.show(EXPLAIN);
    if (next === 'settings') this.settingsView.show(this.settingsStore.value);
    if (next === 'history') this.historyView.show(buildHistory(this.story, HISTORY_SOURCES));
    // 開く音（帳面は紙をめくる音、ほかは控えめな音）
    if (next === 'ledger') this.sound('ledger');
    else if (['notebook', 'plan', 'pause', 'settings', 'history', 'explain'].includes(next)) this.sound('open');
    if (next === 'plan') this.planView.show(buildPlanBoard(this.story, PLAN_SOURCES));
    if (next === 'result') {
      const outcome = buildOutcome(this.story, OUTCOMES, JOURNAL_SOURCES, 'roof');
      if (outcome) this.resultView.show(outcome);
    }
    if (next === 'pause') {
      this.pauseMenu.show(this.pauseContent());
      this.markHint('pause');
    }
    // お知らせ・タイトル・時間経過の中身は、それぞれ showNotice・showTitle・showTransition で表示する
    this.hud.setOverlayMode(next !== 'explore' && next !== 'dialogue');
    this.hud.setTitleMode(next === 'title' || next === 'transition' || next === 'cinematic');
    if (next !== 'explore') this.hideBark();
    // 画面を切り替えたら、押しっぱなしのキーや溜まった視点操作を捨てる
    this.input.reset();
  }

  private refreshNotebookBadge(): void {
    this.hud.setNotebookBadge(buildNotebook(this.story, JOURNAL_SOURCES).latestOrder > this.notebookSeenOrder);
  }

  // ───────── 毎フレームの更新 ─────────

  private update(dt: number): void {
    this.clock += dt;
    if (this.input.wasPressed('F3')) this.hud.toggleDebug();
    if (this.input.wasPressed('KeyH') && this.uiMode !== 'settings') this.changeSettings({ showControls: !this.hud.helpVisible });
    if (this.input.wasPressed('KeyM')) this.toggleMute();

    switch (this.uiMode) {
      case 'title':
        this.handleTitleInput();
        break;
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
      case 'history':
        if (this.input.wasPressed('Escape')) this.closeSubScreen();
        break;
      case 'settings':
        this.handleSettingsInput();
        break;
      case 'pause':
        if (this.input.wasPressed('Escape')) this.dispatch('esc');
        else this.handleMenuInput(this.pauseMenu);
        break;
      case 'notice':
        this.handleMenuInput(this.notice);
        break;
      case 'transition':
        this.transitionView.update(dt);
        if (this.anyConfirm() || this.input.wasPressed('Escape')) this.transitionView.advance();
        break;
      case 'cinematic':
        if (performance.now() >= this.cinematicEnd || this.anyConfirm() || this.input.wasPressed('Escape')) this.dispatch('close');
        break;
    }
    this.input.enabled = allowsExploration(this.uiMode);

    const intent = this.input.getMoveIntent();
    updatePlayer(this.player, intent, this.cameraRig.yaw, dt, this.world);
    const partner = this.interaction.partner;
    if (partner) {
      // 会話・調査の相手の方を向く
      const face = Math.atan2(partner.position.x - this.player.x, partner.position.z - this.player.z);
      this.player.heading = dampAngle(this.player.heading, face, 10, dt);
    } else {
      this.interaction.updateTarget(this.player);
    }
    this.updateArea();
    this.updateCameraZone();

    this.playerView.update(this.player, dt, DEFAULT_PLAYER_TUNING.runSpeed);
    for (const [id, view] of this.npcViews) {
      const talking = partner?.id === id;
      view.update(dt, talking ? this.player : null, talking && this.dialogueBox.isRevealing);
    }
    // 屋根葺きの日：茅を運ぶ人が動いたら、当たり判定を付け直す。作業の進み具合を屋根に表す
    if (this.roofDay.update(dt, this.player)) this.world.setExtraColliders(this.roofDay.colliders());
    this.updateRoofWork(dt);

    const orbitInput = this.input.consumeOrbitInput();
    const look = this.settingsStore.value.invertY ? { ...orbitInput, lookY: -orbitInput.lookY } : orbitInput;
    if (this.uiMode === 'title') {
      // タイトル：村の広場の上から、ゆっくり見回す
      this.cameraRig.update(TITLE_CAMERA.focus, { lookX: -TITLE_CAMERA.turnSpeed * dt * 200, lookY: 0, zoom: 0 }, dt);
    } else if (this.uiMode === 'cinematic') {
      this.cameraRig.update(ROOF_DAY_SHOT.focus, { lookX: -dt * 6, lookY: 0, zoom: 0 }, dt);
    } else {
      this.cameraRig.update(this.cameraFocus(partner), look, dt);
    }
    // 室内の壁際などでカメラがすぐ後ろまで寄ったときは、主人公を半透明にする（消すと位置が分からなくなる）
    const d = this.cameraRig.currentDistance;
    this.playerView.setOpacity(this.uiMode === 'title' ? 1 : d >= 1.7 ? 1 : Math.max(0.3, (d - 0.9) / 0.8));
    this.updateMarker(dt);

    if (this.uiMode === 'explore') this.updateExploreHelpers(dt, intent, look);
    else this.hud.setHint(null);
    this.updateBark(dt);
    this.updateAudio();

    this.renderer.render(this.scene, this.camera);
    this.updateUi(dt);
    this.input.endFrame();
    this.updateStats(dt);
  }

  /** 決定キー（Enter・Space・E）が押されたか。 */
  private anyConfirm(): boolean {
    const i = this.input;
    return i.wasPressed('Enter') || i.wasPressed('NumpadEnter') || i.wasPressed('Space') || i.wasPressed('KeyE');
  }

  private handleExploreInput(): void {
    const input = this.input;
    if (input.wasPressed('Escape')) this.dispatch('esc');
    else if (input.wasPressed('Tab')) this.dispatch('tab');
    else if (input.wasPressed('KeyE')) this.interaction.interact();
  }

  private handleTitleInput(): void {
    const input = this.input;
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.titleScreen.moveSelection(-1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.titleScreen.moveSelection(1);
    if (this.anyConfirm()) this.titleScreen.activate();
  }

  private handleSettingsInput(): void {
    const input = this.input;
    if (input.wasPressed('Escape')) return this.closeSubScreen();
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.settingsView.moveSelection(-1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.settingsView.moveSelection(1);
    if (input.wasPressed('ArrowLeft') || input.wasPressed('KeyA')) this.settingsView.adjust(-1);
    if (input.wasPressed('ArrowRight') || input.wasPressed('KeyD')) this.settingsView.adjust(1);
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter') || input.wasPressed('Space')) this.settingsView.activate();
  }

  // ───────── 操作の手引き・住民のひと言・作業の進み具合（Phase 6） ─────────

  private updateExploreHelpers(
    dt: number,
    intent: { forward: number; right: number; run: boolean },
    look: { lookX: number; lookY: number; zoom: number },
  ): void {
    this.exploreTime += dt;
    const moving = intent.forward !== 0 || intent.right !== 0;
    if (moving) this.movedTime += dt;
    if (this.movedTime > 0.8) this.markHint('move');
    if (moving && intent.run) this.markHint('run');
    this.lookedAmount += Math.abs(look.lookX) + Math.abs(look.lookY) + Math.abs(look.zoom) * 0.2;
    if (this.lookedAmount > 60) this.markHint('look');
    const s = this.settingsStore.value;
    this.hud.setHint(
      s.showHints
        ? selectHint({
            done: new Set(s.hintsDone),
            exploring: true,
            hasTarget: this.interaction.target !== null,
            hasNotebookEntry: this.story.allLearned().length > 0,
            exploreTime: this.exploreTime,
          })
        : null,
    );
  }

  private markHint(id: HintId): void {
    const done = this.settingsStore.value.hintsDone;
    if (done.includes(id)) return;
    this.settingsStore.update({ hintsDone: [...done, id] });
    if (this.hud.hint === id) this.hud.setHint(null);
  }

  /** 屋根葺きの日：着いてからの時間で、南面が軒先から葺き進む。 */
  private updateRoofWork(dt: number): void {
    const decision = this.story.planDecision('roof');
    const stage = this.roofDay.current;
    if (this.story.chapter !== 'roofDay' || !decision || !stage) return;
    const work = roofDayWork(decision.outcome);
    if (!work) return;
    // ポーズ・タイトル・時間経過の間は進めない（見て回っている時間に合わせる）
    if (this.uiMode !== 'pause' && this.uiMode !== 'title' && this.uiMode !== 'transition') this.roofDayElapsed += dt;
    this.world.setRoofWork('sae', { progress: roofDayProgress(work, this.roofDayElapsed), full: stage.extent === 'full' });
  }

  /** 屋根葺きの日、住民・村の人の近くを通ると、頭上に短いひと言が出る。 */
  private updateBark(dt: number): void {
    this.barkGap -= dt;
    if (this.bark) {
      this.bark.time -= dt;
      const at = this.bark.at();
      if (this.bark.time <= 0 || !at || this.uiMode !== 'explore') {
        this.hideBark();
        return;
      }
      this.projected.set(at.x, at.y + 2.3, at.z).project(this.camera);
      if (this.projected.z > 1) this.bubble.hide();
      else {
        const canvas = this.renderer.domElement;
        if (!this.bubble.visible) this.bubble.show(this.bark.name, this.bark.text);
        this.bubble.place((this.projected.x * 0.5 + 0.5) * canvas.clientWidth, (-this.projected.y * 0.5 + 0.5) * canvas.clientHeight);
      }
      return;
    }
    const decision = this.story.planDecision('roof');
    if (this.uiMode !== 'explore' || this.story.chapter !== 'roofDay' || !decision || this.barkGap > 0) return;
    const barks = roofDayBarks(decision.outcome);
    type Candidate = { key: string; name: string | null; dist: number; at: () => { x: number; y: number; z: number } | null };
    const candidates: Candidate[] = [];
    for (const npc of NPCS) {
      const view = this.npcViews.get(npc.id);
      if (!barks[npc.character] || !view) continue;
      const p = view.root.position;
      candidates.push({
        key: npc.character,
        name: CHARACTERS[npc.character as CharacterId].name,
        dist: Math.hypot(p.x - this.player.x, p.z - this.player.z),
        at: () => view.root.position,
      });
    }
    for (const c of this.roofDay.crewSpots()) {
      const id = c.id;
      // 屋根の上の人は高い所にいるので、少し離れていても聞こえる
      const scale = c.role === 'roof' ? BARK.range / BARK.roofRange : 1;
      candidates.push({
        key: `crew:${c.role}`,
        name: '村の人',
        dist: Math.hypot(c.x - this.player.x, c.z - this.player.z) * scale,
        at: () => this.roofDay.crewSpots().find((s) => s.id === id) ?? null,
      });
    }
    const near = candidates
      .filter((c) => c.dist < BARK.range && this.clock - (this.barkLast.get(c.key) ?? -Infinity) > BARK.cooldown)
      .sort((a, b) => a.dist - b.dist)[0];
    const lines = near ? (barks[near.key] ?? []) : [];
    if (!near || lines.length === 0) return;
    const n = this.barkCount.get(near.key) ?? 0;
    this.barkCount.set(near.key, n + 1);
    this.barkLast.set(near.key, this.clock);
    this.barkGap = BARK.gap;
    this.bark = { key: near.key, name: near.name, text: lines[n % lines.length]!, time: BARK.duration, at: near.at };
  }

  private hideBark(): void {
    this.bark = null;
    this.bubble.hide();
  }

  // ───────── 音（Phase 6） ─────────

  private sound(s: UiSound): void {
    this.audio.play(s);
  }

  private updateAudio(): void {
    const mode = this.uiMode;
    const duck =
      mode === 'explore' || mode === 'cinematic'
        ? 'explore'
        : mode === 'dialogue' || mode === 'title' || mode === 'transition'
          ? mode
          : 'overlay';
    this.audio.setDuck(duckFactor(duck));
    const indoor = this.world.indoor;
    this.audio.setAmbient(ambientMix({ x: this.player.x, z: this.player.z, indoor }));
    this.audio.setMood(musicMood(this.story.chapter, mode === 'title' ? 'title' : mode === 'ending' ? 'ending' : 'game'));
    const stage = this.roofDay.current;
    const roofWorkers = stage && this.story.chapter === 'roofDay' && mode !== 'title' ? stage.crew.filter((c) => c.role === 'roof').length : 0;
    // 作業の場（サエ家の南面の前）
    const site = ROOF_DAY_SITE;
    this.audio.setWork(workSound({ distance: Math.hypot(this.player.x - site.x, this.player.z - site.z), roofWorkers, indoor }));
    const steps = this.playerView.consumeSteps();
    if (steps > 0 && mode === 'explore') {
      const running = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
      this.audio.footstep(footstepSurface({ x: this.player.x, z: this.player.z, indoor }), running);
    }
    this.audio.update();
  }

  private toggleMute(): void {
    const muted = !this.settingsStore.value.muted;
    this.changeSettings({ muted });
    if (this.uiMode !== 'title') this.toasts.push('音', muted ? '音を消した（M でもとに戻す）' : '音を出した');
  }

  // ───────── 設定（Phase 6） ─────────

  private changeSettings(patch: Partial<Settings>): void {
    const ok = this.settingsStore.update(patch);
    const s = this.settingsStore.value;
    this.applySettings(s);
    this.settingsView.update(s);
    if (!ok && this.uiMode === 'settings') this.settingsView.setStatus('この環境では設定を保存できない（この回だけ反映する）。');
  }

  private applySettings(s: Settings): void {
    this.audio.setVolumes(effectiveVolumes(s));
    this.cameraRig.settings = orbitSettingsFor(s.lookSensitivity);
    this.dialogueBox.charsPerSecond = CHARS_PER_SECOND[s.textSpeed];
    this.hud.setHelpVisible(s.showControls);
    if (!s.showHints) this.hud.setHint(null);
  }

  // ───────── 画面の行き来（Phase 6） ─────────

  /** 設定・選んだことの記録・解説を開く。閉じたら今の画面（タイトル・ポーズ・結果・エンディング）に戻る。 */
  private openSubScreen(action: 'openSettings' | 'openHistory' | 'openExplain'): void {
    const from = this.uiMode;
    this.dispatch(action);
    if (this.uiMode !== from) this.returnTo = RETURN_ACTION[from] ? from : null;
  }

  private closeSubScreen(): void {
    const back = this.returnTo;
    this.returnTo = null;
    this.dispatch('close');
    if (!back) return;
    if (back === 'title') this.showTitle();
    else {
      const action = RETURN_ACTION[back];
      if (action) this.dispatch(action);
    }
  }

  /** 時間の経過の画面を出す。閉じたら then を実行する。 */
  private showTransition(content: TransitionContent, then: () => void): void {
    this.dispatch('openTransition');
    if (this.uiMode !== 'transition') return;
    this.afterTransition = then;
    this.transitionView.show(content);
    this.sound('transition');
  }

  private finishTransition(): void {
    if (this.uiMode !== 'transition') return;
    const then = this.afterTransition;
    this.afterTransition = null;
    this.dispatch('close');
    this.flashFade();
    then?.();
  }

  /** 屋根葺きの日の短い見渡し（数秒。決定キー・Esc で飛ばせる）。 */
  private startCinematic(): void {
    this.dispatch('openCinematic');
    if (this.uiMode !== 'cinematic') return;
    this.cinematicEnd = performance.now() + ROOF_DAY_SHOT.seconds * 1000;
    this.cameraRig.reset(ROOF_DAY_SHOT.yaw);
    this.cameraRig.setFraming(ROOF_DAY_SHOT.pitch, ROOF_DAY_SHOT.distance);
  }

  private endCinematic(): void {
    this.cinematicEnd = 0;
    this.applyFraming();
    this.cameraRig.reset(this.player.heading);
    this.flashFade();
  }

  /**
   * 宗平の作業場の中では、カメラを屋根の下に収まる近めの距離にし、壁際では回り込む（Phase 6.5）。
   * 出たら、入る前の距離と高さに戻す。サエ家の室内（setIndoorMode）とは別に扱う。
   */
  private updateCameraZone(): void {
    if (this.world.indoor) return;
    const inside = isInsideWorkshop(this.player.x, this.player.z);
    if (inside === this.inWorkshop) return;
    this.inWorkshop = inside;
    const orbit = this.cameraRig.orbit;
    this.cameraRig.avoidWalls = inside;
    if (inside) {
      this.workshopSavedCamera = { pitch: orbit.targetPitch, distance: orbit.targetDistance };
      this.cameraRig.limits = WORKSHOP_ORBIT_LIMITS;
      this.cameraRig.lookHeight = 1.6;
      orbit.targetPitch = Math.min(Math.max(orbit.targetPitch, 0.3), 0.6);
      orbit.targetDistance = 4.2;
    } else {
      this.cameraRig.limits = DEFAULT_ORBIT_LIMITS;
      this.cameraRig.lookHeight = OUTDOOR_LOOK_HEIGHT;
      orbit.targetPitch = this.workshopSavedCamera?.pitch ?? OUTDOOR_FRAMING.pitch;
      orbit.targetDistance = this.workshopSavedCamera?.distance ?? OUTDOOR_FRAMING.distance;
      this.workshopSavedCamera = null;
    }
  }

  /** 屋内・屋外に合わせた最初の構図にする。 */
  private applyFraming(): void {
    const f = this.world.indoor ? INDOOR_FRAMING : OUTDOOR_FRAMING;
    this.cameraRig.setFraming(f.pitch, f.distance);
  }

  // ───────── タイトル（Phase 6） ─────────

  private showTitle(): void {
    this.dispatch('openTitle');
    if (this.uiMode !== 'title') return;
    const result = this.saveStore.load();
    this.titleSave = result;
    let status = '';
    if (result.ok) {
      const when = new Date(result.save.savedAt);
      const chapter = result.save.story.chapter;
      status = `前回の記録：${Number.isNaN(when.getTime()) ? '日時不明' : when.toLocaleString('ja-JP')}（${CHAPTER_LABEL[chapter] ?? ''}）`;
    } else if (result.reason === 'corrupt' || result.reason === 'unsupported') {
      status =
        (result.reason === 'corrupt' ? '保存されていた記録が壊れていたため、読み込めませんでした。' : 'この版では読めない記録でした。') +
        '読めなかった記録は消さずに別名で残してあります。';
    } else if (result.reason === 'unavailable') {
      status = 'この環境では進み具合を記録できません（遊ぶことはできます）。';
    }
    this.titleScreen.show({
      items: [
        { id: 'continue', label: 'つづきから', disabled: !result.ok },
        { id: 'new', label: 'はじめから' },
        { id: 'settings', label: '設定' },
        { id: 'explain', label: '史実と創作について' },
      ],
      defaultId: result.ok ? 'continue' : 'new',
      ...(status ? { status } : {}),
    });
    this.cameraRig.reset(0);
    this.cameraRig.setFraming(TITLE_CAMERA.pitch, TITLE_CAMERA.distance);
  }

  private onTitleItem(id: string): void {
    this.sound('confirm');
    const result = this.titleSave;
    switch (id) {
      case 'continue':
        if (!result?.ok) return;
        this.applySave(result.save);
        this.dispatch('close');
        return;
      case 'new':
        if (result?.ok) {
          this.showNotice(
            {
              title: 'はじめから遊びますか？',
              body: '前回の記録は、次に自動で記録されるときに上書きされます。',
              items: [
                { id: 'no', label: 'やめる' },
                { id: 'yes', label: 'はじめから遊ぶ' },
              ],
              defaultId: 'no',
            },
            { no: () => this.showTitle(), yes: () => this.startNewGame() },
          );
        } else this.startNewGame();
        return;
      case 'settings':
        return this.openSubScreen('openSettings');
      case 'explain':
        return this.openSubScreen('openExplain');
    }
  }

  /** 最初から始める（導入の画面 → 村へ）。 */
  private startNewGame(): void {
    if (this.uiMode === 'title') this.dispatch('close');
    this.resetToNewGame();
    this.showTransition(OPENING, () => undefined);
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
      if (!decideLocked) {
        if (choices > 0) this.sound('confirm');
        this.confirmDialogue();
      }
      return;
    }
    if (choices === 0) return;
    if (input.wasPressed('ArrowUp') || input.wasPressed('KeyW')) this.interaction.moveSelection(-1);
    if (input.wasPressed('ArrowDown') || input.wasPressed('KeyS')) this.interaction.moveSelection(1);
    if (decideLocked) return;
    for (let i = 0; i < Math.min(choices, 9); i++) {
      if (input.wasPressed(`Digit${i + 1}`) || input.wasPressed(`Numpad${i + 1}`)) {
        this.sound('confirm');
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
    this.markHint('talk');

    const partner = this.interaction.partner;
    // 屋根など高い所・広い物を調べる間は、観察の構図にする（Phase 6.5）
    if (partner?.id === id && partner.kind === 'object' && partner.view) this.cameraRig.shot = partner.view;
    if (partner?.id !== id || partner.kind !== 'npc') return;
    // 住民との会話は、相手と自分が斜めに見える構図へ寄せる（設計書 L：会話時は人物が見やすい構図へ）
    const orbit = this.cameraRig.orbit;
    this.savedCamera = { pitch: orbit.targetPitch, distance: orbit.targetDistance, lookHeight: this.cameraRig.lookHeight };
    this.cameraRig.lookHeight = Math.min(this.cameraRig.lookHeight, TALK_CAMERA.lookHeight);
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
    // 室内：近め・やや見下ろし、注視点を低く、壁際では横へ回り込む（Phase 6）。屋外に出たら元の構図に戻す
    this.cameraRig.avoidWalls = indoor;
    this.cameraRig.lookHeight = indoor ? 1.45 : OUTDOOR_LOOK_HEIGHT;
    if (indoor) {
      this.outdoorCamera = { pitch: orbit.targetPitch, distance: orbit.targetDistance };
      this.cameraRig.limits = INDOOR_ORBIT_LIMITS;
      this.cameraRig.setFraming(INDOOR_FRAMING.pitch, INDOOR_FRAMING.distance);
    } else {
      this.cameraRig.limits = DEFAULT_ORBIT_LIMITS;
      this.cameraRig.setFraming(this.outdoorCamera?.pitch ?? OUTDOOR_FRAMING.pitch, this.outdoorCamera?.distance ?? OUTDOOR_FRAMING.distance);
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
    this.cameraRig.shot = null;
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
    const promisesBefore = this.story.allPromises().length;
    // 決めた瞬間の手帳・意向・約束の通知は出さず、決定の知らせにまとめる（Phase 6）
    this.quietNotices = true;
    const outcome = this.story.decidePlan({ source: '作業台で決めた' });
    this.quietNotices = false;
    if (!outcome || !planId) return;
    this.sound('decide');
    this.saveGame();
    if (planId === 'roof') {
      // 屋根葺きの日へ（章は決定の効果で進んでいる）。決めた時点では、まだ葺いていない
      const decision = this.story.planDecision('roof');
      const promises = this.story.allPromises().slice(promisesBefore);
      const lines = [
        decision ? `決めた段取り：${describePlan(this.story, decision.plan, 'roof')}` : '',
        '関係する皆が承知し、屋根葺きの準備が整った。',
        ...promises.map((p) => `約束を書き留めた：${p.content}`),
      ].filter((l) => l !== '');
      this.placePlayerAt({ x: 1.5, z: 15.5, heading: Math.PI });
      this.showNotice(
        { title: '段取りが決まった', body: lines.join('\n'), items: [{ id: 'ok', label: '作業の日を迎える' }], solid: true },
        { ok: () => this.beginRoofDay(outcome) },
      );
    } else {
      this.dispatch('openEnding');
    }
  }

  /** 屋根葺きの日の朝：誰が来て、茅と足場がどうなっているかを短く示し、作業の場を見渡してから村へ。 */
  private beginRoofDay(outcome: string): void {
    const arrival = roofDayArrival(outcome);
    this.roofDayElapsed = 0;
    this.showTransition(
      {
        kicker: arrival && arrival.when !== '屋根葺きの日' ? arrival.when : 'その日',
        title: '屋根葺きの日',
        lines: [...(arrival?.lines ?? []), '村を歩いて、誰がどこで何をしているか見て回ろう。サエと話すと一日を終えられる。'],
        button: '村に出る',
      },
      () => this.startCinematic(),
    );
  }

  /** 結果画面を閉じたとき。屋根葺きの日の結果なら、三年後（第3幕）へ進む。 */
  private onResultClosed(): void {
    this.dispatch('close');
    if (this.story.chapter !== 'roofDay') return;
    const meanwhile = shownLines(this.story, MEANWHILE);
    // 暗転の間に村を三年後の様子にしておき、明けたら村に出る
    this.enterChapter3();
    this.showTransition(
      {
        kicker: 'それから',
        title: '三年後の秋',
        lines: [...meanwhile, '今度は、伊助家の屋根を葺き替える時が来た。'],
        button: '村に出る',
      },
      () => undefined,
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
    const name = (h: string) => HOUSEHOLDS[h]?.name ?? h;
    const settle = (s: string) => (s === 'settled' ? '返し 済' : s === 'open' ? '返し まだ' : '取り決めなし');
    // 結帳：十五年前の伊助家の手伝い（返したかどうか）と、この物語で書き加えられた記録
    const records = ledgerEntries(this.story).flatMap((e) =>
      e.items
        .filter((i) => e.id === 'L3' || e.id === 'L4' || i.id === 'L1-isuke')
        .map((i) => `${e.when}：${name(i.from)} → ${name(i.to)}　${i.detail}（${settle(i.settlement)}）`),
    );
    const promises = buildNotebook(this.story, JOURNAL_SOURCES).promises.map((p) => ({ text: `${p.from} → ${p.to}：${p.content}`, kept: p.kept }));
    return {
      code: ending?.code ?? '',
      title: ending?.title ?? '',
      story: ending ? [...shownLines(this.story, MEANWHILE), ...shownLines(this.story, ending.story)] : [],
      achieved: ending ? shownLines(this.story, ending.achieved) : [],
      remains: ending ? shownLines(this.story, ending.remains) : [],
      choices: [
        { label: '第1幕', text: act1Summary(roof?.outcome) },
        { label: '第3幕', text: decision ? describePlan(this.story, decision.plan, 'isukeRoof') : '—' },
      ],
      records,
      promises,
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
    // 作業の進み具合の見た目は屋根葺きの日だけ（それ以外の章では屋根の状態の見た目に戻す）
    if (chapter !== 'roofDay') this.world.setRoofWork('sae', null);
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
    this.cameraRig.lookHeight = this.savedCamera.lookHeight;
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

  private pauseContent(status = ''): MenuContent {
    const decided = this.story.planDecision('roof') !== null;
    const objective = currentObjective(this.story);
    return {
      title: 'ポーズ',
      ...(objective ? { body: `いまできること：${objective}` } : {}),
      items: [
        { id: 'resume', label: '再開する［Esc］' },
        { id: 'notebook', label: '手帳を開く［Tab］' },
        ...(decided ? [{ id: 'history', label: '選んだことの記録' }] : []),
        { id: 'settings', label: '設定（音量・視点の感度など）' },
        { id: 'save', label: '記録する' },
        { id: 'load', label: '最後の記録から再開する' },
        { id: 'explain', label: '史実と創作について' },
        { id: 'title', label: 'タイトルに戻る' },
        { id: 'new', label: '最初からやり直す' },
      ],
      defaultId: 'resume',
      status: status || '会話や調査を終えるたびに、自動で記録されます。',
    };
  }

  private onPauseItem(id: string): void {
    this.sound('confirm');
    switch (id) {
      case 'resume':
        return this.dispatch('close');
      case 'notebook':
        return this.dispatch('openNotebook');
      case 'explain':
        return this.openSubScreen('openExplain');
      case 'settings':
        return this.openSubScreen('openSettings');
      case 'history':
        return this.openSubScreen('openHistory');
      case 'save': {
        const ok = this.saveGame();
        const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        this.pauseMenu.setStatus(ok ? `記録しました（${time}）` : '記録できませんでした（保存領域を使えません）');
        return;
      }
      case 'title':
        // 今の位置も含めて記録してからタイトルへ（「つづきから」で同じ所から再開できる）
        this.saveGame();
        this.dispatch('close');
        return this.showTitle();
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
          { no: () => undefined, yes: () => this.startNewGame() },
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
    this.applyFraming();
    this.cameraRig.reset(p.heading);
    this.area = null;
    this.toasts.clear();
    this.hideBark();
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

  /** 住民の頭上の名前：探索中、6〜16m の距離にいる人だけ（近くでは案内表示と重ならないよう出さない）。 */
  private updateNameTags(): void {
    const items: Array<{ id: string; name: string; x: number; y: number; opacity: number }> = [];
    if (this.uiMode === 'explore' && !this.world.indoor) {
      const canvas = this.renderer.domElement;
      for (const [id, view] of this.npcViews) {
        const p = view.root.position;
        const d = Math.hypot(p.x - this.player.x, p.z - this.player.z);
        if (d < NAME_TAG.near || d > NAME_TAG.far || this.interaction.target?.id === id) continue;
        this.projected.set(p.x, p.y + 2.35 * view.root.scale.y, p.z).project(this.camera);
        if (this.projected.z > 1 || Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1) continue;
        const def = NPCS.find((n) => n.id === id);
        const name = def ? CHARACTERS[def.character as CharacterId].name : id;
        // 遠いほど薄く
        const opacity = 0.9 * (1 - Math.max(0, (d - NAME_TAG.far + 4) / 4));
        items.push({ id, name, x: (this.projected.x * 0.5 + 0.5) * canvas.clientWidth, y: (-this.projected.y * 0.5 + 0.5) * canvas.clientHeight, opacity });
      }
    }
    this.nameTags.update(items);
  }

  private updateUi(dt: number): void {
    this.updateNameTags();
    const view = this.interaction.view;
    const partner = this.interaction.partner;
    if (view && partner) {
      // ページが変わったら、控えめに紙を送る音
      const key = `${view.scriptId}:${view.nodeId}:${view.page}`;
      if (key !== this.lastDialogueKey) {
        if (this.lastDialogueKey !== '') this.sound('page');
        this.lastDialogueKey = key;
      }
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
    } else {
      this.lastDialogueKey = '';
      if (this.dialogueBox.visible) this.dialogueBox.hide();
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
