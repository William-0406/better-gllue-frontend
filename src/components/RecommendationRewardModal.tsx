import { Button, Modal } from 'animal-island-ui';
import { Sparkles, Trophy, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { RecommendationReward, RecommendationStats } from '../types/gllue';

interface RecommendationRewardModalProps {
  reward: RecommendationReward | null;
  stats: RecommendationStats;
  onClose: () => void;
}

export function RecommendationRewardModal({ reward, stats, onClose }: RecommendationRewardModalProps) {
  return (
    <Modal
      open={Boolean(reward)}
      title={reward?.title ?? '推荐达成'}
      width={620}
      typewriter={false}
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <Button type="primary" icon={<X size={16} />} onClick={onClose}>
            收下鼓励
          </Button>
        </div>
      }
    >
      {reward ? (
        <div className="reward-panel">
          <div className="reward-burst" aria-hidden="true">
            {Array.from({ length: 18 }).map((_, index) => (
              <span key={index} style={{ '--i': index } as CSSProperties} />
            ))}
          </div>
          <div className="reward-medal">
            <Trophy size={42} />
          </div>
          <p className="reward-kicker">
            <Sparkles size={16} />
            推荐已确认
          </p>
          <strong>{reward.message}</strong>
          <div className="reward-context">
            <span>{reward.candidateName || '候选人已加入流程'}</span>
            <span>{reward.jobName || reward.companyName || '项目进度已更新'}</span>
          </div>
          <div className="reward-stats">
            <div>
              <small>今日推荐</small>
              <b>{stats.todayCount}</b>
            </div>
            <div>
              <small>累计推荐</small>
              <b>{stats.totalCount}</b>
            </div>
            <div>
              <small>连续天数</small>
              <b>{stats.streakDays}</b>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
