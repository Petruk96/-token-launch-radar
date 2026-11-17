import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ageDays,
  boardIssue,
  buildRadar,
  dataScript,
  impliedValue,
  isRankable,
  MODEL,
  parseSnapshot,
  SnapshotError,
  type Snapshot,
  type SnapshotProtocol,
} from '../lib/model.ts';

function protocol(i: number, overrides: Partial<SnapshotProtocol> = {}): SnapshotProtocol {
  return {
    slug: `p${String(i).padStart(3, '0')}`,
    name: `Protocol ${i}`,
    category: 'Dexs',
    chains: ['Ethereum'],
    tvl_usd: 5_000_000 + i * 100_000,
    change_7d: (i % 11) - 5,
    mcap_usd: null,
    listed_at: '2025-01-01',
    gecko_id: null,
    symbol: null,
    ...overrides,
  };
}

function syntheticSnapshot(): Snapshot {
  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < 125; i++) {
    const overrides = i === 0 ? { tvl_usd: 100_000_000 } : i === 1 ? { tvl_usd: 80_000_000, category: 'RWA' } : i === 2 ? { tvl_usd: 60_000_000, category: null } : {};
    protocols.push(protocol(i, overrides));
  }
  for (let i = 0; i < 5; i++) {
    protocols.push(protocol(200 + i, { slug: `live${i}`, name: `Live ${i}`, tvl_usd: 20_000_000 + i * 1_000_000, mcap_usd: 100_000_000 + i * 1_000_000, gecko_id: `gecko${i}`, symbol: `L${i}`, category: i === 0 ? 'CEX' : 'Dexs' }));
  }
  return {
    as_of: '2026-11-14',
    source: 'synthetic test snapshot',
    floor_usd: 50_000_000,
    protocols,
    watchlist: ['p000', 'p001', 'p002'],
  };
}

test('ageDays counts whole UTC days and clamps at zero', () => {
  assert.equal(ageDays('2026-11-14', '2026-11-04'), 10);
  assert.equal(ageDays('2026-11-14', '2026-11-20'), 0);
  assert.equal(ageDays('2026-11-14', null), null);
  assert.equal(ageDays('2026-11-14', 'not-a-date'), null);
});

test('impliedValue follows TVL, clamped growth and age', () => {
  const p = protocol(0, { tvl_usd: 100_000_000, change_7d: 10, listed_at: '2025-11-14' });
  const value = impliedValue(p, '2026-11-14', MODEL);
  assert.ok(value.implied > 0);
  assert.equal(value.age, 365);
  assert.equal(value.growthPct, 10);
  assert.ok(value.growthMult > 1);
  assert.ok(value.maturityMult > MODEL.maturity_floor);
  const high = impliedValue({ ...p, change_7d: 999 }, '2026-11-14', MODEL);
  assert.equal(high.growthPct, MODEL.growth_cap);
  const low = impliedValue({ ...p, change_7d: -999 }, '2026-11-14', MODEL);
  assert.equal(low.growthPct, MODEL.growth_floor);
  const older = impliedValue({ ...p, listed_at: '2020-01-01' }, '2026-11-14', MODEL);
  assert.ok(older.maturityMult > value.maturityMult);
});

test('isRankable keeps launch candidates and drops products of live tokens', () => {
  assert.equal(isRankable(protocol(0)), true);
  assert.equal(isRankable(protocol(0, { name: 'Wrapped Example' })), false);
  assert.equal(isRankable(protocol(0, { name: 'Example Staked' })), false);
  assert.equal(isRankable(protocol(0, { name: 'Example V2' })), false);
  assert.equal(isRankable(protocol(0, { category: 'Bridge' })), false);
  assert.equal(isRankable(protocol(0, { name: 'Binance Example' })), false);
  assert.equal(isRankable(protocol(0, { symbol: 'EX', mcap_usd: 1, gecko_id: 'example' })), false);
});

test('buildBoard covers the watchlist, adds early rows and keeps live tokens apart', () => {
  const snapshot = syntheticSnapshot();
  const { board, radar } = buildRadar(snapshot);
  assert.ok(board.length >= 100);
  assert.equal(boardIssue(board, snapshot), null);
  assert.equal(new Set(board.map((row) => row.slug)).size, board.length);
  for (const slug of snapshot.watchlist) assert.ok(board.some((row) => row.slug === slug), `${slug} is covered`);
  assert.ok(board.some((row) => row.early));
  assert.equal(board.some((row) => row.slug.startsWith('live')), false);
  assert.ok(radar.live_total >= 5);
  assert.ok(radar.live_size >= 1);
  assert.ok(radar.live.every((row) => row.slug !== 'live0'), 'CEX is not in the live leader view');
  for (let i = 0; i < board.length; i++) {
    assert.equal(board[i]!.rank, i + 1);
    if (i > 0) assert.ok(board[i]!.implied_value_usd <= board[i - 1]!.implied_value_usd);
    assert.ok(board[i]!.farm_steps.length >= 3 && board[i]!.farm_steps.length <= 12);
    for (const step of board[i]!.farm_steps) assert.ok(step.trim().length >= 20 && step.trim().length <= 600);
  }
  const script = dataScript(radar);
  assert.ok(script.startsWith('window.RADAR='));
  assert.ok(script.endsWith(';\n'));
});

test('parseSnapshot refuses a document that is not the sealed shape', () => {
  assert.throws(() => parseSnapshot('{'), SnapshotError);
  assert.throws(() => parseSnapshot('[]'), SnapshotError);
  assert.throws(() => parseSnapshot('{"as_of":"x"}'), SnapshotError);
});

const snapshotPath = process.env.TOKEN_RADAR_SNAPSHOT;
test('the sealed snapshot produces a gate-shaped board', { skip: !snapshotPath }, () => {
  const snapshot = parseSnapshot(readFileSync(snapshotPath!, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  assert.equal(boardIssue(board, snapshot), null);
  assert.ok(board.length >= 100 && board.length <= 4000);
  assert.equal(radar.watchlist_size, snapshot.watchlist.length);
  for (const slug of snapshot.watchlist) assert.ok(board.some((row) => row.slug === slug));
  assert.ok(board.filter((row) => row.early).length >= 60);
  assert.ok(radar.live_total > radar.live_size);
  assert.ok(radar.median_implied_usd > 0);
  const serialized = JSON.stringify({ rows: board });
  assert.ok(Buffer.byteLength(serialized, 'utf8') < 8 * 1024 * 1024);
});
