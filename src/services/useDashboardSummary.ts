import { useEffect, useState } from 'react';
import { gllueApi } from './api';
import type { Candidate, ClientCompany, JobOrder, PipelineSubmission, TodoItem } from '../types/gllue';

interface DashboardSummary {
  loading: boolean;
  fromMock: boolean;
  totals: {
    candidates: number;
    clients: number;
    jobs: number;
    todos: number;
    pipeline: number;
    weeklyRecommended: number;
    weeklyInterviews: number;
  };
  latest: {
    candidates: Candidate[];
    clients: ClientCompany[];
    jobs: JobOrder[];
    todos: TodoItem[];
    pipeline: PipelineSubmission[];
    todayCandidates: Candidate[];
    weeklyRecommended: PipelineSubmission[];
    weeklyInterviews: PipelineSubmission[];
  };
}

export function useDashboardSummary() {
  const [summary, setSummary] = useState<DashboardSummary>({
    loading: true,
    fromMock: false,
    totals: { candidates: 0, clients: 0, jobs: 0, todos: 0, pipeline: 0, weeklyRecommended: 0, weeklyInterviews: 0 },
    latest: { candidates: [], clients: [], jobs: [], todos: [], pipeline: [], todayCandidates: [], weeklyRecommended: [], weeklyInterviews: [] },
  });

  useEffect(() => {
    let active = true;
    Promise.all([
      gllueApi.getCandidates(1, 6),
      gllueApi.getClients(1, 6),
      gllueApi.getJobs(1, 6),
      gllueApi.getTodos(1, 6),
      gllueApi.getPipeline(1, 6),
      gllueApi.getTodayCandidates(80),
      gllueApi.getWeeklyKpiWorkflows(12),
    ]).then(([candidates, clients, jobs, todos, pipeline, todayCandidates, weeklyKpi]) => {
      if (!active) return;
      setSummary({
        loading: false,
        fromMock: Boolean(candidates.fromMock || clients.fromMock || jobs.fromMock || todos.fromMock || pipeline.fromMock || todayCandidates.fromMock || weeklyKpi.fromMock),
        totals: {
          candidates: candidates.count,
          clients: clients.count,
          jobs: jobs.count,
          todos: todos.count,
          pipeline: pipeline.count,
          weeklyRecommended: weeklyKpi.recommended.count,
          weeklyInterviews: weeklyKpi.interviews.count,
        },
        latest: {
          candidates: candidates.list,
          clients: clients.list,
          jobs: jobs.list,
          todos: todos.list,
          pipeline: pipeline.list,
          todayCandidates: todayCandidates.list,
          weeklyRecommended: weeklyKpi.recommended.list,
          weeklyInterviews: weeklyKpi.interviews.list,
        },
      });
    });
    return () => {
      active = false;
    };
  }, []);

  return summary;
}
