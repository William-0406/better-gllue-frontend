import { gllueApi } from './api';
import type { PendingRecommendation, PipelineSubmission, RecommendationReward, RecommendationStats } from '../types/gllue';

const PENDING_KEY = 'gllue-shell-pending-recommendations';
const STATS_KEY = 'gllue-shell-recommendation-stats';
const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 72 * DAY_MS;

type HandoffContext = Omit<PendingRecommendation, 'id' | 'startedAt' | 'expiresAt' | 'snapshot'>;

const rewardTitles = [
  '推荐达成',
  '项目推进 +1',
  '新的连接建立了',
  '人才信号已发送',
  '今日进度点亮',
  'Pipeline 能量补给',
  '一次漂亮的交接',
  '顾问行动完成',
  '机会桥梁搭好了',
  '新的候选旅程开启',
];

const messageTemplates = [
  '你刚刚为 {jobName} 送出一位新的可能性，{companyName} 的下一步多了一束光。',
  '{candidateName} 已经进入 {jobName} 的视野，感谢你把合适的人带到合适的机会旁边。',
  '推荐完成。{companyName} 的成长地图上，刚刚多了你推进的一格。',
  'Nice move! {jobName} 收到一张新的人才卡牌，今天的顾问经验值上涨。',
  '你为 {candidateName} 和 {companyName} 之间搭了一座桥，项目进度轻轻往前走了一步。',
  '{jobName} 的候选池扩容成功。感谢你为这个项目补上一块关键拼图。',
  '今日推荐 +1。你把信息、判断和机会连接成了一次真实推进。',
  '{companyName} 收到你的助攻，项目地图上的下一站更近了。',
  '这次推荐很稳。{candidateName} 的故事，已经被带到 {jobName} 面前。',
  '新的流程记录已确认。你刚刚完成了一次漂亮的人才传送。',
  '{jobName} 进度条微微发亮，感谢你为项目发展贡献一枚推进点。',
  '顾问雷达命中。{candidateName} 已进入新机会轨道。',
  '你让 {companyName} 多认识了一位值得关注的人，也让候选人多看到一个可能。',
  '推荐成功入账。今天的你，又给团队 pipeline 添了一点动能。',
  '{jobName} 获得新候选人，项目士气 +1，顾问判断力 +1。',
  '一条新的职业路径被点亮了。谢谢你把 {candidateName} 推向更大的舞台。',
  '这不是普通点击，是一次让机会流动起来的动作。',
  '{companyName} 的人才拼图新增一片，来自你的精准推荐。',
  '流程确认完成。你的推荐已经从想法变成了谷露里的真实记录。',
  '你刚刚把一个“也许合适”推进成了“值得聊聊”。',
  '{jobName} 收到新补给，今天的项目推进看起来更有底气了。',
  '推荐完成，顾问徽章闪了一下。合适的人，正在靠近合适的位置。',
  '一次新连接已经建立，{candidateName} 和 {companyName} 的可能性开始发芽。',
  '你的判断刚刚落地成一条新流程，感谢你为项目多争取一个选择。',
  '{jobName} 的候选名单更新了，项目宇宙新增一颗亮点。',
  '推荐确认。你把复杂的信息整理成了一次清晰的前进。',
  '人才流转成功，机会网络扩张中。今天这一步很有价值。',
  '{companyName} 的发展路上，多了一份来自你的认真筛选。',
  '项目推进记录已点亮。小小一步，常常就是结果开始变化的地方。',
  '你为 {jobName} 增加了一位新候选人，也为后续沟通打开了一扇门。',
  '推荐达成，今日能量上升。让机会被看见，本身就是很重要的工作。',
  '{candidateName} 已加入新的项目线索，感谢你把人才价值送到需要它的地方。',
  '一次推荐，一次连接，一点向前。{jobName} 已收到你的贡献。',
  '这条推荐记录很安静，但它可能是某个好结果的开头。',
  '项目卡槽已更新。{companyName} 的候选探索多了一个认真选项。',
  '你的推荐已确认，pipeline 里又多了一次真实的推进。',
  '今天的顾问任务完成一项：发现、判断、连接。',
  '{jobName} 新增候选人，感谢你让项目选择面变得更宽。',
  '推荐成功。你刚刚把一个名字变成了一次机会。',
  '候选人与项目的距离缩短了，幕后推手就是你。',
  '{companyName} 的未来队伍里，也许正需要这样的新可能。',
  '好球。{jobName} 的推进表上，刚刚多了一次有效动作。',
  '你把信息送到了该出现的位置，接下来交给项目继续生长。',
  '推荐记录已确认，今日贡献值 +1。',
  '这一步有点像点亮路标：让人、岗位和公司更容易相遇。',
  '{candidateName} 已经进入流程，愿这次连接走向一个漂亮结果。',
  '你为 {companyName} 的发展多打开一个人才窗口。',
  '这次推荐完成得很漂亮，既克制又有效。',
  '项目进度被你轻轻推了一下，但这一下很重要。',
  '感谢你为 {jobName} 添上一份新可能，今天的 pipeline 更丰盛了一点。',
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function dateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function previousDateKey(value = new Date()) {
  return dateKey(new Date(value.getTime() - DAY_MS));
}

function pick<T>(items: T[], seed: string) {
  const value = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return items[value % items.length];
}

function fillTemplate(template: string, reward: Pick<RecommendationReward, 'candidateName' | 'jobName' | 'companyName'>) {
  const candidateName = reward.candidateName || '这位候选人';
  const jobName = reward.jobName || '这个项目';
  const companyName = reward.companyName || '客户公司';
  return template.split('{candidateName}').join(candidateName).split('{jobName}').join(jobName).split('{companyName}').join(companyName);
}

function submissionDate(submission: PipelineSubmission) {
  return String(submission.lastUpdateDate || submission.dateAdded || '');
}

async function getSnapshot(context: HandoffContext) {
  const response = context.candidateId
    ? await gllueApi.getCandidateSubmissions(context.candidateId, 20)
    : context.jobId
      ? await gllueApi.getJobSubmissions(context.jobId, 20)
      : { list: [], count: 0, fromMock: false };
  return {
    count: response.count,
    reliable: !response.fromMock,
    submissionIds: response.list.map((item) => item.id).filter(Boolean),
  };
}

function getPendingRecommendations() {
  const now = Date.now();
  return readJson<PendingRecommendation[]>(PENDING_KEY, []).filter((item) => new Date(item.expiresAt).getTime() > now);
}

function savePendingRecommendations(items: PendingRecommendation[]) {
  writeJson(PENDING_KEY, items);
}

function buildReward(pending: PendingRecommendation, submission?: PipelineSubmission): RecommendationReward {
  const seed = `${pending.id}-${submission?.id ?? 'confirmed'}`;
  const candidateName = submission?.candidate?.chineseName || submission?.candidate?.englishName || pending.candidateName;
  const jobName = submission?.joborder?.jobTitle || submission?.joborder?.__name__ || pending.jobName;
  const companyName = submission?.joborder?.client?.name || submission?.joborder?.client?.__name__ || pending.companyName;
  return {
    id: `reward-${submission?.id ?? pending.id}`,
    title: pick(rewardTitles, seed),
    message: fillTemplate(pick(messageTemplates, seed), { candidateName, jobName, companyName }),
    candidateName,
    jobName,
    companyName,
    rewardedAt: new Date().toISOString(),
    submissionId: submission?.id,
  };
}

export async function startRecommendationHandoff(context: HandoffContext) {
  const now = new Date();
  const snapshot = await getSnapshot(context).catch(() => ({ count: 0, reliable: false, submissionIds: [] }));
  const pending: PendingRecommendation = {
    ...context,
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString(),
    snapshot,
  };
  const next = [pending, ...getPendingRecommendations()].slice(0, 8);
  savePendingRecommendations(next);
  return pending;
}

export async function checkPendingRecommendation() {
  const pending = getPendingRecommendations();
  if (!pending.length) return null;

  for (const item of pending) {
    const response = item.candidateId
      ? await gllueApi.getCandidateSubmissions(item.candidateId, 20)
      : item.jobId
        ? await gllueApi.getJobSubmissions(item.jobId, 20)
        : null;
    if (!response || response.fromMock) continue;

    const known = new Set(item.snapshot.submissionIds);
    const startedAt = new Date(item.startedAt).getTime();
    const fresh = response.list.find((submission) => {
      if (known.has(submission.id)) return false;
      const time = new Date(submissionDate(submission).replace(' ', 'T')).getTime();
      if (!Number.isFinite(time)) return item.snapshot.reliable;
      return time + 60_000 >= startedAt;
    });

    if (fresh || (item.snapshot.reliable && response.count > item.snapshot.count)) {
      const reward = buildReward(item, fresh);
      const rewardedIds = new Set(getRecommendationStats().recentRewards.map((recent) => recent.id));
      const nextPending = pending.filter((candidate) => candidate.id !== item.id);
      savePendingRecommendations(nextPending);
      if (rewardedIds.has(reward.id)) return null;
      return reward;
    }
  }

  savePendingRecommendations(pending);
  return null;
}

export function getRecommendationStats(): RecommendationStats {
  const stats = readJson<RecommendationStats>(STATS_KEY, {
    todayCount: 0,
    totalCount: 0,
    streakDays: 0,
    recentRewards: [],
  });
  const today = dateKey();
  if (stats.lastRewardAt && dateKey(new Date(stats.lastRewardAt)) !== today) {
    return { ...stats, todayCount: 0 };
  }
  return stats;
}

export function recordRecommendationReward(reward: RecommendationReward) {
  const stats = getRecommendationStats();
  const today = dateKey();
  const lastDay = stats.lastRewardAt ? dateKey(new Date(stats.lastRewardAt)) : '';
  const alreadyToday = lastDay === today;
  const streakDays = alreadyToday ? Math.max(1, stats.streakDays) : lastDay === previousDateKey() ? stats.streakDays + 1 : 1;
  const next: RecommendationStats = {
    todayCount: alreadyToday ? stats.todayCount + 1 : 1,
    totalCount: stats.totalCount + 1,
    streakDays,
    lastRewardAt: reward.rewardedAt,
    recentRewards: [reward, ...stats.recentRewards.filter((item) => item.id !== reward.id)].slice(0, 20),
  };
  writeJson(STATS_KEY, next);
  return next;
}
