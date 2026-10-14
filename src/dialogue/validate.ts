import type { DialogueScript, NodeId } from './types';

/**
 * 会話データの構造を検査し、問題の一覧を返す（空なら問題なし）。
 * 会話を追加・編集したときに、進行不能や参照切れを自動テストで検出するために使う。
 */
export function validateScript(script: DialogueScript, knownSpeakers: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const at = (where: string) => `[${script.id}] ${where}`;
  const nodeIds = Object.keys(script.nodes);
  const exists = (id: NodeId) => Object.prototype.hasOwnProperty.call(script.nodes, id);

  if (script.entries.length === 0) errors.push(at('入口がない'));
  const lastEntry = script.entries[script.entries.length - 1];
  if (lastEntry?.when) errors.push(at('最後の入口に条件がある（どの条件も成立しないと会話を始められない）'));
  for (const e of script.entries) {
    if (!exists(e.node)) errors.push(at(`入口の場面 ${e.node} が存在しない`));
  }

  for (const id of nodeIds) {
    const node = script.nodes[id]!;
    if (node.lines.length === 0 || node.lines.some((l) => l.trim() === '')) {
      errors.push(at(`場面 ${id} に空のページがある`));
    }
    if (node.speaker !== undefined && !knownSpeakers.has(node.speaker)) {
      errors.push(at(`場面 ${id} の話し手 ${node.speaker} が未登録`));
    }
    if (node.next !== undefined && node.choices) errors.push(at(`場面 ${id} に next と choices の両方がある`));
    if (node.next !== undefined && !exists(node.next)) errors.push(at(`場面 ${id} の next ${node.next} が存在しない`));
    if (node.choices) {
      if (node.choices.length === 0) errors.push(at(`場面 ${id} の選択肢が空`));
      if (node.choices.every((c) => c.when)) {
        errors.push(at(`場面 ${id} の選択肢がすべて条件付き（条件なしの選択肢を1つ以上置く）`));
      }
      for (const c of node.choices) {
        if (c.text.trim() === '') errors.push(at(`場面 ${id} に空の選択肢がある`));
        if (c.next !== undefined && !exists(c.next)) errors.push(at(`場面 ${id} の選択肢の行き先 ${c.next} が存在しない`));
      }
    }
  }

  // 入口から到達できない場面（書き忘れ・参照ミスの検出）
  const reachable = new Set<NodeId>();
  const stack = script.entries.map((e) => e.node).filter(exists);
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = script.nodes[id]!;
    for (const n of successors(node)) if (exists(n)) stack.push(n);
  }
  for (const id of nodeIds) if (!reachable.has(id)) errors.push(at(`場面 ${id} にどこからも到達できない`));

  // すべての場面から会話の終わりに到達できること（抜け出せない循環の検出）。
  // 条件付きの選択肢は表示されないことがあるため、条件なしの選択肢だけで終われることを求める。
  const canEnd = new Set<NodeId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of nodeIds) {
      if (canEnd.has(id)) continue;
      const node = script.nodes[id]!;
      const ends =
        node.choices !== undefined
          ? node.choices.some((c) => !c.when && (c.next === undefined || canEnd.has(c.next)))
          : node.next === undefined || canEnd.has(node.next);
      if (ends) {
        canEnd.add(id);
        changed = true;
      }
    }
  }
  for (const id of nodeIds) if (!canEnd.has(id)) errors.push(at(`場面 ${id} から会話を終えられない`));

  return errors;
}

function successors(node: DialogueScript['nodes'][string]): NodeId[] {
  const list: NodeId[] = [];
  if (node.next !== undefined) list.push(node.next);
  for (const c of node.choices ?? []) if (c.next !== undefined) list.push(c.next);
  return list;
}
