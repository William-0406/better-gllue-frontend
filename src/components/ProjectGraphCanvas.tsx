// 项目图谱 · 节点-连线可视化。
// 没有引入 AntV G6 / Graphin 这类外部图可视化库——这台机器上没法在 Windows 目标平台上装包+联调测试
// （交接手册 §3 的 rolldown 跨平台坑同样适用于任何原生渲染依赖），为了这次改动能直接可用、不需要你
// 先 npm install 再祈祷能跑，这里用纯 SVG + 一个很小的力导向布局实现，零新增依赖。
// 数据来源就是 ProjectMap 传进来的 projects（本地 localStorage），项目一变，图谱跟着重新布局，
// 所以是"实时生成"的——不是静态图片。
//
// 交互：滚轮缩放（以鼠标位置为锚点）、拖空白处平移画布、拖节点手动摆位、悬停高亮关联节点/边、
// 工具栏放大/缩小/适应画布/重新排列、搜索定位、双击节点聚焦到它和它的邻居。视野（viewport）用
// SVG viewBox 直接表达，不用额外的 <g transform>，缩放本质就是改 viewBox 的宽高，平移就是改
// viewBox 的 x/y。
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeamProject } from '../types/gllue';

type HubKind = 'company' | 'title' | 'location';
type NodeKind = HubKind | 'project';

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  weight: number;
  project?: TeamProject;
}

interface GraphEdge {
  source: string;
  target: string;
  hub: HubKind;
}

interface Point {
  x: number;
  y: number;
}

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

const KIND_COLOR: Record<NodeKind, string> = {
  company: '#5b7ae0',
  title: '#9a7be0',
  location: '#3fae8a',
  project: '#e0954f',
};

// 柔和描边风格：节点用浅色填充 + 同色描边（KIND_COLOR），不再用光泽渐变。
const KIND_FILL: Record<NodeKind, string> = {
  company: '#eef2fe',
  title: '#f0eafc',
  location: '#e4f4ee',
  project: '#fbeede',
};

const KIND_LABEL: Record<NodeKind, string> = {
  company: '公司',
  title: '职位',
  location: 'base 地点',
  project: '项目',
};

const VIEWPORT_ASPECT = 1000 / 620;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildGraph(projects: TeamProject[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();

  const ensureHub = (kind: HubKind, value: string) => {
    const id = `${kind}:${value}`;
    if (!nodes.has(id)) nodes.set(id, { id, kind, label: value, weight: 0 });
    degree.set(id, (degree.get(id) ?? 0) + 1);
    return id;
  };

  projects.forEach((project) => {
    const projectId = `project:${project.id}`;
    nodes.set(projectId, {
      id: projectId,
      kind: 'project',
      label: project.title || project.company || `项目 #${project.id}`,
      weight: 1,
      project,
    });
    if (project.company.trim()) edges.push({ source: projectId, target: ensureHub('company', project.company.trim()), hub: 'company' });
    if (project.title.trim()) edges.push({ source: projectId, target: ensureHub('title', project.title.trim()), hub: 'title' });
    if (project.location.trim()) edges.push({ source: projectId, target: ensureHub('location', project.location.trim()), hub: 'location' });
  });

  degree.forEach((value, id) => {
    const node = nodes.get(id);
    if (node) node.weight = value;
  });

  return { nodes: Array.from(nodes.values()), edges };
}

function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], seed: Map<string, Point>, width: number, height: number) {
  const positions = new Map<string, Point>();
  nodes.forEach((node, index) => {
    const prev = seed.get(node.id);
    if (prev) {
      positions.set(node.id, { x: prev.x, y: prev.y });
      return;
    }
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.32;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 16,
      y: height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 16,
    });
  });

  const radius = new Map<string, number>();
  nodes.forEach((node) => radius.set(node.id, nodeRadius(node)));

  // 关联关系不变（边还是照旧连），只是给不同类型的边不同的布局力：
  // 公司是有区分度的连接器 → 短而强的弹簧，项目紧贴自己的公司成簇；
  // 职位/地点太通用 → 长而弱的弹簧，只保留关联、不把全图拉成一坨。
  const SPRING: Record<HubKind, { length: number; strength: number }> = {
    company: { length: 64, strength: 0.055 },
    title: { length: 230, strength: 0.006 },
    location: { length: 260, strength: 0.004 },
  };

  const iterations = nodes.length > 260 ? 120 : 240;
  const repulsion = 3600;
  const centerStrength = 0.0016;
  const cx = width / 2;
  const cy = height / 2;

  for (let iter = 0; iter < iterations; iter += 1) {
    const forces = new Map<string, Point>();
    nodes.forEach((node) => forces.set(node.id, { x: 0, y: 0 }));

    // 斥力：用“扣掉两点半径后的间隙”来算，大节点之间推得更开。
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const pa = positions.get(a.id) as Point;
        const pb = positions.get(b.id) as Point;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          distSq = 1;
        }
        const dist = Math.sqrt(distSq);
        const gap = Math.max(1, dist - (radius.get(a.id) ?? 8) - (radius.get(b.id) ?? 8));
        const force = repulsion / (gap * gap);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        (forces.get(a.id) as Point).x += fx;
        (forces.get(a.id) as Point).y += fy;
        (forces.get(b.id) as Point).x -= fx;
        (forces.get(b.id) as Point).y -= fy;
      }
    }

    // 弹簧：按边的类型取不同强度/长度（公司强、职位/地点弱）。
    edges.forEach((edge) => {
      const pa = positions.get(edge.source);
      const pb = positions.get(edge.target);
      if (!pa || !pb) return;
      const spring = SPRING[edge.hub];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const displacement = dist - spring.length;
      const force = displacement * spring.strength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fa = forces.get(edge.source);
      const fb = forces.get(edge.target);
      if (fa) {
        fa.x += fx;
        fa.y += fy;
      }
      if (fb) {
        fb.x -= fx;
        fb.y -= fy;
      }
    });

    nodes.forEach((node) => {
      const p = positions.get(node.id) as Point;
      const f = forces.get(node.id) as Point;
      f.x += (cx - p.x) * centerStrength;
      f.y += (cy - p.y) * centerStrength;
    });

    nodes.forEach((node) => {
      const p = positions.get(node.id) as Point;
      const f = forces.get(node.id) as Point;
      p.x += Math.max(-9, Math.min(9, f.x));
      p.y += Math.max(-9, Math.min(9, f.y));
      p.x = Math.max(24, Math.min(width - 24, p.x));
      p.y = Math.max(24, Math.min(height - 24, p.y));
    });

    // 硬性防重叠：两点圆面一旦重叠，就沿连线把它们各推开一半。
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const pa = positions.get(a.id) as Point;
        const pb = positions.get(b.id) as Point;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist = 1;
        }
        const minDist = (radius.get(a.id) ?? 8) + (radius.get(b.id) ?? 8) + 6;
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          pa.x = Math.max(24, Math.min(width - 24, pa.x + ux * push));
          pa.y = Math.max(24, Math.min(height - 24, pa.y + uy * push));
          pb.x = Math.max(24, Math.min(width - 24, pb.x - ux * push));
          pb.y = Math.max(24, Math.min(height - 24, pb.y - uy * push));
        }
      }
    }
  }

  return positions;
}

function nodeRadius(node: GraphNode) {
  if (node.kind === 'project') return 7;
  // 收窄 hub 大小差异（原来最大能到 32，太夸张）：13 ~ 21 之间。
  return 11 + Math.min(10, node.weight * 2);
}

// 把所有节点框进一个符合 VIEWPORT_ASPECT 比例的 viewBox 里，留一点边距，
// 这样一变化(新增/删除项目、重新排列)就自动"缩放适应"，不用用户自己去找内容在哪。
function fitViewport(nodes: GraphNode[], positions: Map<string, Point>): Viewport {
  if (!nodes.length) return { x: 0, y: 0, w: 1000, h: 620 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((node) => {
    const p = positions.get(node.id);
    if (!p) return;
    const r = nodeRadius(node) + 34;
    minX = Math.min(minX, p.x - r);
    maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r);
    maxY = Math.max(maxY, p.y + r);
  });
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1000, h: 620 };
  const bboxW = Math.max(40, maxX - minX);
  const bboxH = Math.max(40, maxY - minY);
  let w: number;
  let h: number;
  if (bboxW / bboxH > VIEWPORT_ASPECT) {
    w = bboxW;
    h = w / VIEWPORT_ASPECT;
  } else {
    h = bboxH;
    w = h * VIEWPORT_ASPECT;
  }
  const pad = 1.1;
  w *= pad;
  h *= pad;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

interface ProjectGraphCanvasProps {
  projects: TeamProject[];
  onSelectProject: (project: TeamProject) => void;
  onFilterHub: (kind: HubKind, value: string) => void;
}

export function ProjectGraphCanvas({ projects, onSelectProject, onFilterHub }: ProjectGraphCanvasProps) {
  const { nodes, edges } = useMemo(() => buildGraph(projects), [projects]);
  const signature = useMemo(() => nodes.map((n) => n.id).sort().join('|'), [nodes]);

  // world 坐标系尺寸：节点越多，世界越大（留够摆放空间），跟屏幕上实际显示多大无关——
  // 显示多大由下面的 viewport（缩放/平移）决定，两者分开就不会出现"节点一多就被压得看不清"的问题。
  const worldWidth = Math.max(760, Math.round(Math.sqrt(Math.max(1, nodes.length) * 150 * 150 * 1.6)));
  const worldHeight = Math.round(worldWidth * 0.62);

  const seedRef = useRef(new Map<string, Point>());
  const [positions, setPositions] = useState<Map<string, Point>>(new Map());
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, w: 1000, h: 620 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number; moved: boolean } | null>(null);
  const panState = useRef<{ startX: number; startY: number; viewport: Viewport } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const justDraggedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(
    () => () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    },
    [],
  );

  // 全屏：用浏览器原生 Fullscreen API 把整块图谱放到全屏（Esc 可退出）。
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.();
  };

  // 滚轮缩放必须用原生 addEventListener + { passive: false }，不能用 React 的 onWheel：
  // React/浏览器会把 wheel 监听器默认注册成 passive，此时 event.preventDefault() 是没用的
  // （控制台会报 "Unable to preventDefault inside passive event listener"），表现就是鼠标放在
  // 图谱上滚轮，画布缩放的同时页面还是跟着上下滚——两个动作打架。这里手动挂一个非 passive 的
  // 原生监听器，彻底吃掉这个 wheel 事件，页面就不会再跟着滚了。
  // 用 viewportRef 读最新视野，这样这个 effect 只需要在 worldWidth 变化时重新挂一次，
  // 不用每次缩放/平移都重新绑定监听器。
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const handleNativeWheel = (event: WheelEvent) => {
      // 非全屏时：只有按住 Ctrl/⌘ 才缩放，普通滚轮放行给页面滚动（否则鼠标停在这块画布上
      // 会吃掉滚轮，页面滚不动、回不到上面的筛选栏）。全屏时没有页面滚动问题，普通滚轮直接缩放。
      if (!document.fullscreenElement && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const v = viewportRef.current;
      const anchorX = v.x + ((event.clientX - rect.left) / rect.width) * v.w;
      const anchorY = v.y + ((event.clientY - rect.top) / rect.height) * v.h;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      setViewport((current) => {
        const newW = clamp(current.w / factor, worldWidth * 0.05, worldWidth * 3.5);
        const newH = newW / VIEWPORT_ASPECT;
        const ratioX = (anchorX - current.x) / current.w;
        const ratioY = (anchorY - current.y) / current.h;
        return { x: anchorX - ratioX * newW, y: anchorY - ratioY * newH, w: newW, h: newH };
      });
    };
    svg.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleNativeWheel);
  }, [worldWidth]);

  useEffect(() => {
    const next = layoutGraph(nodes, edges, seedRef.current, worldWidth, worldHeight);
    seedRef.current = next;
    setPositions(new Map(next));
    setViewport(fitViewport(nodes, next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const relayout = () => {
    seedRef.current = new Map();
    const next = layoutGraph(nodes, edges, seedRef.current, worldWidth, worldHeight);
    seedRef.current = next;
    setPositions(new Map(next));
    setViewport(fitViewport(nodes, next));
  };

  const fitToScreen = () => setViewport(fitViewport(nodes, positions));

  // 聚焦到某个节点 + 它的直接邻居（公司/职位/地点节点邻居是挂在它上面的项目，
  // 项目节点的邻居是它的公司/职位/地点），视野缩放去框住这一小圈，而不是缩到只剩它自己一个点。
  const focusNode = (node: GraphNode) => {
    const neighborSet = new Set<string>([node.id]);
    edges.forEach((edge) => {
      if (edge.source === node.id) neighborSet.add(edge.target);
      if (edge.target === node.id) neighborSet.add(edge.source);
    });
    const focusNodes = nodes.filter((n) => neighborSet.has(n.id));
    const focusPositions = new Map<string, Point>();
    focusNodes.forEach((n) => {
      const p = positions.get(n.id);
      if (p) focusPositions.set(n.id, p);
    });
    const next = fitViewport(focusNodes, focusPositions);
    const minW = worldWidth * 0.16;
    if (next.w < minW) {
      const cx = next.x + next.w / 2;
      const cy = next.y + next.h / 2;
      const minH = minW / VIEWPORT_ASPECT;
      next.x = cx - minW / 2;
      next.y = cy - minH / 2;
      next.w = minW;
      next.h = minH;
    }
    setViewport(next);
    setHovered(node.id);
  };

  const zoomBy = (factor: number, anchor?: Point) => {
    setViewport((v) => {
      const cx = anchor ? anchor.x : v.x + v.w / 2;
      const cy = anchor ? anchor.y : v.y + v.h / 2;
      const newW = clamp(v.w / factor, worldWidth * 0.05, worldWidth * 3.5);
      const newH = newW / VIEWPORT_ASPECT;
      const ratioX = (cx - v.x) / v.w;
      const ratioY = (cy - v.y) / v.h;
      return { x: cx - ratioX * newW, y: cy - ratioY * newH, w: newW, h: newH };
    });
  };

  const toWorldPoint = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: viewport.x + ((clientX - rect.left) / rect.width) * viewport.w,
      y: viewport.y + ((clientY - rect.top) / rect.height) * viewport.h,
    };
  };

  const handleNodePointerDown = (nodeId: string) => (event: React.PointerEvent<SVGGElement>) => {
    event.stopPropagation();
    const point = toWorldPoint(event.clientX, event.clientY);
    const current = positions.get(nodeId);
    if (!current) return;
    dragState.current = { id: nodeId, offsetX: current.x - point.x, offsetY: current.y - point.y, startX: event.clientX, startY: event.clientY, moved: false };
    setDraggingId(nodeId);
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    panState.current = { startX: event.clientX, startY: event.clientY, viewport };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragState.current) {
      const drag = dragState.current;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
        drag.moved = true;
      }
      const point = toWorldPoint(event.clientX, event.clientY);
      const x = Math.max(20, Math.min(worldWidth - 20, point.x + drag.offsetX));
      const y = Math.max(20, Math.min(worldHeight - 20, point.y + drag.offsetY));
      const next = new Map(positions);
      next.set(drag.id, { x, y });
      seedRef.current.set(drag.id, { x, y });
      setPositions(next);
      return;
    }
    const pan = panState.current;
    const svg = svgRef.current;
    if (pan && svg) {
      const rect = svg.getBoundingClientRect();
      const dxWorld = ((event.clientX - pan.startX) / rect.width) * pan.viewport.w;
      const dyWorld = ((event.clientY - pan.startY) / rect.height) * pan.viewport.h;
      setViewport({ ...pan.viewport, x: pan.viewport.x - dxWorld, y: pan.viewport.y - dyWorld });
    }
  };

  const handlePointerUp = () => {
    if (dragState.current?.moved) justDraggedRef.current = true;
    dragState.current = null;
    panState.current = null;
    setDraggingId(null);
  };

  // 单击/双击用同一个原生 click 事件区分：单击先等 220ms 再真正执行（打开编辑/按它筛选），
  // 这段时间里如果又点了一次（浏览器判定为双击），就取消单击动作，只走双击的"聚焦"逻辑。
  // 不然双击一个项目节点会先后触发"打开编辑" + "聚焦"两个动作，体验很怪。
  const handleNodeClick = (node: GraphNode) => {
    // 拖动摆位后浏览器仍会派发一次 click，这里跳过，避免误触发“编辑/筛选”。
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      if (node.kind === 'project' && node.project) {
        onSelectProject(node.project);
      } else if (node.kind !== 'project') {
        onFilterHub(node.kind, node.label);
      }
    }, 220);
  };

  const handleNodeDoubleClick = (node: GraphNode) => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    focusNode(node);
  };

  const searchMatches = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return [];
    return nodes.filter((node) => node.label.toLowerCase().includes(query)).slice(0, 8);
  }, [searchText, nodes]);

  const handleSearchSelect = (node: GraphNode) => {
    focusNode(node);
    setSearchText('');
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && searchMatches.length) {
      handleSearchSelect(searchMatches[0]);
    } else if (event.key === 'Escape') {
      setSearchText('');
    }
  };

  const neighborIds = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    edges.forEach((edge) => {
      if (edge.source === hovered) set.add(edge.target);
      if (edge.target === hovered) set.add(edge.source);
    });
    return set;
  }, [hovered, edges]);

  if (!projects.length) {
    return <div className="leaderboard-empty">暂无项目，先在上面添加几条试试。</div>;
  }

  return (
    <div className={`project-graph${isFullscreen ? ' is-fullscreen' : ''}`} ref={rootRef}>
      <div className="project-graph-toolbar">
        <div className="project-graph-legend">
          {(['company', 'title', 'location', 'project'] as NodeKind[]).map((kind) => (
            <span key={kind} className="project-graph-legend-item">
              <i style={{ background: KIND_COLOR[kind] }} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>
        <div className="project-graph-toolbar-actions">
          <button type="button" className="project-graph-btn" onClick={() => zoomBy(1.25)} title="放大">
            ＋
          </button>
          <button type="button" className="project-graph-btn" onClick={() => zoomBy(1 / 1.25)} title="缩小">
            －
          </button>
          <button type="button" className="project-graph-btn" onClick={fitToScreen}>
            适应画布
          </button>
          <button type="button" className="project-graph-btn" onClick={relayout}>
            重新排列
          </button>
          <button type="button" className="project-graph-btn" onClick={toggleFullscreen}>
            {isFullscreen ? '退出全屏' : '全屏'}
          </button>
        </div>
      </div>
      <div className="project-graph-search">
        <input
          type="text"
          className="project-graph-search-input"
          placeholder="搜索公司 / 职位 / 地点 / 项目，回车定位第一个结果…"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        {searchText ? (
          <button type="button" className="project-graph-search-clear" onClick={() => setSearchText('')} aria-label="清空搜索">
            ×
          </button>
        ) : null}
        {searchText.trim() ? (
          <div className="project-graph-search-results">
            {searchMatches.length ? (
              searchMatches.map((node) => (
                <button key={node.id} type="button" className="project-graph-search-result" onClick={() => handleSearchSelect(node)}>
                  <span className="project-graph-search-result-kind" style={{ background: KIND_COLOR[node.kind] }}>
                    {KIND_LABEL[node.kind]}
                  </span>
                  {node.label}
                </button>
              ))
            ) : (
              <div className="project-graph-search-empty">没有匹配的节点</div>
            )}
          </div>
        ) : null}
      </div>
      <p className="project-graph-hint"><b style={{ color: '#5f4b33' }}>缩放：按住 Ctrl / ⌘ + 滚轮</b>（普通滚轮＝翻页）；拖空白平移、拖节点摆位；点 公司/职位/地点 节点＝按它筛选，点项目节点＝编辑，双击＝聚焦，悬停＝高亮关联。</p>
      <div className="project-graph-svg-wrap">
        <svg
          ref={svgRef}
          className="project-graph-svg"
          viewBox={`${viewport.x} ${viewport.y} ${viewport.w} ${viewport.h}`}
          onPointerDown={handleBackgroundPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {edges.map((edge, index) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (!a || !b) return null;
            const dim = neighborIds ? !(neighborIds.has(edge.source) && neighborIds.has(edge.target)) : false;
            // 连线分层：公司实一点，职位/地点淡一点，一眼看出主次。
            const base = edge.hub === 'company' ? 0.5 : edge.hub === 'title' ? 0.28 : 0.22;
            return <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="project-graph-edge" opacity={dim ? 0.07 : base} />;
          })}
          {nodes.map((node) => {
            const p = positions.get(node.id);
            if (!p) return null;
            const radius = nodeRadius(node);
            const isHovered = hovered === node.id;
            const isDragging = draggingId === node.id;
            const dim = neighborIds ? !neighborIds.has(node.id) : false;
            const label = node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label;
            // 中文字比拉丁字符宽（约 10.5px vs 6.6px），分别计宽，芯片才不会顶字。
            const labelPx = Array.from(label).reduce((w, ch) => w + (/[　-〿㐀-鿿＀-￯]/.test(ch) ? 10.5 : 6.6), 0);
            const labelWidth = clamp(labelPx + 14, 26, 150);
            // 减少字海：hub（公司/职位/地点）始终显示标签；项目节点默认只是个小点，
            // 悬停、拖动、或被高亮时才显示名字。
            const showLabel = node.kind !== 'project' || isHovered || isDragging || Boolean(neighborIds?.has(node.id));
            return (
              <g
                key={node.id}
                transform={`translate(${p.x}, ${p.y})`}
                className={`project-graph-node${isDragging ? ' is-dragging' : ''}`}
                opacity={dim ? 0.22 : 1}
                onPointerDown={handleNodePointerDown(node.id)}
                onPointerEnter={() => setHovered(node.id)}
                onPointerLeave={() => setHovered((current) => (current === node.id ? null : current))}
                onClick={() => handleNodeClick(node)}
                onDoubleClick={() => handleNodeDoubleClick(node)}
              >
                {isHovered ? <circle r={radius + 4} className="project-graph-node-ring" /> : null}
                <circle
                  r={radius}
                  fill={KIND_FILL[node.kind]}
                  stroke={KIND_COLOR[node.kind]}
                  strokeWidth={node.kind === 'project' ? 2 : 2.5}
                  className="project-graph-node-circle"
                />
                {showLabel ? (
                  <>
                    <rect x={-labelWidth / 2} y={radius + 4} width={labelWidth} height={16} rx={8} className="project-graph-label-bg" />
                    <text y={radius + 16} textAnchor="middle" className="project-graph-label">
                      {label}
                    </text>
                  </>
                ) : null}
                {isHovered ? (
                  <text y={-radius - 10} textAnchor="middle" className="project-graph-tooltip">
                    {node.kind === 'project' ? `${node.project?.company || ''} · ${node.project?.title || ''}` : `${KIND_LABEL[node.kind]}：${node.label}（${node.weight} 个项目）`}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
