import type { StoryDefinitions } from '../../src/story/types';

/** テスト用の小さな物語定義。 */
export const TEST_DEFS: StoryDefinitions = {
  topics: {
    villager: {
      id: 'villager',
      title: '村人の都合',
      person: 'villager',
      stages: [
        { id: 'refused', category: 'unconfirmed', text: '断られた' },
        { id: 'reason', category: 'known', text: '理由が分かった' },
        { id: 'alternative', category: 'known', text: '別の案がある' },
      ],
    },
    field: {
      id: 'field',
      title: '畑',
      stages: [{ id: 'seen', category: 'known', text: '刈り入れ中' }],
    },
  },
  requests: { help: { id: 'help', label: '手伝い' }, lend: { id: 'lend', label: '貸し出し' } },
  npcs: ['villager', 'other'],
  households: ['a', 'b'],
};
