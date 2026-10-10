// 관리자 전용 경품 순위 계산 검사.
// 가상 기록만 사용한다. DB·Gist 조회/저장 및 시계 변경 없음.

import { isDeepStrictEqual } from 'node:util';
import { Board } from './_lib/board.js';
import {
  checkDevPassword,
  handlePost,
  preflight,
} from './_lib/http.js';

export const OPTIONS = preflight;

export function POST(request) {
  return handlePost(request, async (body) => {
    checkDevPassword(body?.password);

    const deadline = Date.parse('2026-12-13T00:00:00+09:00');
    const checks = [];

    function check(game, name, actual, expected) {
      checks.push({
        game,
        name,
        passed: isDeepStrictEqual(actual, expected),
      });
    }

    for (const game of ['rps', 'chase']) {
      const score = game === 'rps' ? 'streak' : 'ms';
      const board = new Board({
        file: `${game}.json`,
        score,
        tokenKey: game,
        ttl: 0,
      });

      function record(id, value, end) {
        return {
          id,
          name: `가상하객-${id}`,
          [score]: value,
          at: new Date(deadline - 60000).toISOString(),
          end: new Date(end).toISOString(),
        };
      }

      function state(records, prizeRecords = []) {
        return {
          records,
          prizeRecords,
          burned: {},
          contacts: {},
        };
      }

      const before = record('before', 10, deadline - 1);
      const exact = record('exact', 20, deadline);
      const after = record('after', 30, deadline + 1);

      check(
        game,
        '마감시각 설정 일치',
        board.result(null, state([])).prize.deadline,
        new Date(deadline).toISOString()
      );

      check(
        game,
        '마감 1ms 전 포함',
        board.prizeRanking([before]).map((r) => r.id),
        ['before']
      );

      check(
        game,
        '마감 정각 제외',
        board.prizeRanking([exact]).map((r) => r.id),
        []
      );

      check(
        game,
        '마감 1ms 후 제외',
        board.prizeRanking([after]).map((r) => r.id),
        []
      );

      const oldBest = record('same', 10, deadline - 1);
      const newBest = record('same', 99, deadline + 1);
      const separated = board.result(
        'same',
        state([oldBest, newBest], [oldBest])
      );

      check(
        game,
        '마감 후 일반 최고점 갱신',
        separated.ranking.map((r) => r[score]),
        [99]
      );

      check(
        game,
        '마감 후에도 경품 점수 유지',
        separated.prize.ranking.map((r) => r[score]),
        [10]
      );

      const archived = board.result(
        'same',
        state([], [oldBest])
      );

      check(
        game,
        '경품 보존 기록만으로 순위 계산',
        {
          generalCount: archived.ranking.length,
          prizeIds: archived.prize.ranking.map((r) => r.id),
          prizeRank: archived.prize.rank,
          canContact: archived.prize.canContact,
        },
        {
          generalCount: 0,
          prizeIds: ['same'],
          prizeRank: 1,
          canContact: true,
        }
      );

      const candidates = [
        record('zero', 0, deadline - 10),
        record('a', 40, deadline - 9),
        record('b', 30, deadline - 8),
        record('c', 20, deadline - 7),
        record('d', 10, deadline - 6),
      ];

      check(
        game,
        '0점은 순위에서 제외',
        board.ranking(candidates).map((r) => r.id),
        ['a', 'b', 'c', 'd']
      );

            check(
        game,
        '경품은 TOP 3까지만',
        board.prizeRanking(candidates).map((r) => r.id),
        ['a', 'b', 'c']
      );

      // 등록 가능 여부 계산만 검사한다.
      // 실제 캐릭터 인증·연락처 저장·403 응답·DB 잠금은 검사하지 않는다.
      for (const [id, expectedRank] of [
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]) {
        const prize = board.result(id, state(candidates)).prize;

        check(
          game,
          `경품 ${expectedRank}위 연락처 등록 가능 여부`,
          {
            rank: prize.rank,
            canContact: prize.canContact,
          },
          {
            rank: expectedRank,
            canContact: true,
          }
        );
      }

      for (const [id, label] of [
        ['d', '경품 4위'],
        ['zero', '0점 캐릭터'],
        ['missing', '기록 없는 캐릭터'],
      ]) {
        const prize = board.result(id, state(candidates)).prize;

        check(
          game,
          `${label} 연락처 등록 불가 여부`,
          {
            rank: prize.rank,
            canContact: prize.canContact,
          },
          {
            rank: null,
            canContact: false,
          }
        );
      }

      const lateLeader = record('d', 99, deadline + 1);
      const withLateRecord = state(
        [...candidates, lateLeader],
        candidates
      );

      const outsider = board.result('d', withLateRecord);

      check(
        game,
        '마감 후 기록으로 일반 1위여도 경품 자격 없음',
        {
          generalRank: outsider.rank,
          prizeRank: outsider.prize.rank,
          canContact: outsider.prize.canContact,
        },
        {
          generalRank: 1,
          prizeRank: null,
          canContact: false,
        }
      );

      const retained = board.result('c', withLateRecord);

      check(
        game,
        '마감 후 기록 추가에도 기존 경품 3위 자격 유지',
        {
          generalRank: retained.rank,
          prizeRank: retained.prize.rank,
          canContact: retained.prize.canContact,
        },
        {
          generalRank: 4,
          prizeRank: 3,
          canContact: true,
        }
      );
    }

    return {
      status: 200,
      body: {
        ok: checks.every((item) => item.passed),
        memoryOnly: true,
        total: checks.length,
        passed: checks.filter((item) => item.passed).length,
        checks,
      },
    };
  });
}
