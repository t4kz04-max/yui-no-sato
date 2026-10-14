import { any, flag, knows, type Condition } from '../story/conditions';

/**
 * サエ家に上がってよいか（Phase 5.5、docs/PHASE5_5_PLAN.md §3）。
 * - サエに「結帳を見せてほしい」と頼むと許しが出る（フラグ asked:saeLedger）。
 * - すでに結帳を読んだことがある記録（Phase 5 以前の保存。結帳が縁先にあった頃）も、許しがあるものとみなす。
 * 一度得た許しは以後も続く（毎回同じ会話をしなくてよい）。
 */
export const SAE_HOUSE_OPEN: Condition = any(flag('asked:saeLedger'), knows('ledger.basics', 'read'));
