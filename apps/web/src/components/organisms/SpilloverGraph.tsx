/**
 * Polar SVG layout — primary entity at center; related entities on rings keyed
 * by relationship type. Edge weight → line opacity. Pure SSR-friendly.
 */
import type { RelationshipRow } from '@/lib/api';

interface Node {
  id: string;
  type: RelationshipRow['type'];
  weight: number;
  inbound: boolean;
}

const TYPE_ORDER: RelationshipRow['type'][] = [
  'supplier',
  'customer',
  'peer',
  'partner',
  'competitor',
  'subsidiary',
];

const TYPE_COLOR: Record<RelationshipRow['type'], string> = {
  supplier: '#7dd3fc', // cyan
  customer: '#a7f3d0', // emerald-200
  peer: '#fbbf24', // amber
  partner: '#c4b5fd', // violet
  competitor: '#fca5a5', // rose
  subsidiary: '#9ca3af', // gray
};

const SIZE = 480;
const CENTER = SIZE / 2;
const RADIUS = 180;

export function SpilloverGraph({
  primary,
  relationships,
}: {
  primary: string;
  relationships: RelationshipRow[];
}) {
  const nodes: Node[] = relationships.map((r) => ({
    id: r.fromEntityId === primary ? r.toEntityId : r.fromEntityId,
    type: r.type,
    weight: r.weight,
    inbound: r.toEntityId === primary,
  }));

  // Group by type, then place each group in its own arc segment
  const groups = new Map<RelationshipRow['type'], Node[]>();
  for (const n of nodes) {
    const arr = groups.get(n.type) ?? [];
    arr.push(n);
    groups.set(n.type, arr);
  }

  const presentTypes = TYPE_ORDER.filter((t) => groups.has(t));
  const arcs: { node: Node; x: number; y: number; angle: number }[] = [];
  if (presentTypes.length > 0) {
    const slice = (2 * Math.PI) / presentTypes.length;
    presentTypes.forEach((type, ti) => {
      const list = groups
        .get(type)
        ?.slice()
        .sort((a, b) => b.weight - a.weight);
      const start = ti * slice;
      const end = start + slice;
      list.forEach((node, ni) => {
        const t = list.length === 1 ? 0.5 : ni / (list.length - 1);
        const angle = start + (end - start) * t;
        const r = RADIUS * (0.55 + 0.45 * node.weight);
        arcs.push({
          node,
          angle,
          x: CENTER + r * Math.cos(angle),
          y: CENTER + r * Math.sin(angle),
        });
      });
    });
  }

  return (
    <div className="overflow-hidden">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="block w-full max-w-[480px]"
        role="img"
        aria-label={`${primary} relationship graph`}
      >
        {/* concentric rings */}
        {[0.55, 0.75, 1].map((scale) => (
          <circle
            key={scale}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS * scale}
            fill="none"
            stroke="#262626"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
        ))}

        {/* edges */}
        {arcs.map(({ node, x, y }) => (
          <line
            key={`${node.id}:${node.type}`}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke={TYPE_COLOR[node.type]}
            strokeWidth={1}
            opacity={0.25 + 0.55 * node.weight}
          />
        ))}

        {/* nodes */}
        {arcs.map(({ node, x, y }) => {
          const labelOffset = 8;
          const cosA = Math.cos(Math.atan2(y - CENTER, x - CENTER));
          const sinA = Math.sin(Math.atan2(y - CENTER, x - CENTER));
          const lx = x + cosA * labelOffset;
          const ly = y + sinA * labelOffset;
          const anchor = cosA > 0.3 ? 'start' : cosA < -0.3 ? 'end' : 'middle';
          return (
            <g key={`${node.id}:${node.type}:node`}>
              <circle
                cx={x}
                cy={y}
                r={3.5}
                fill={TYPE_COLOR[node.type]}
                stroke="#0a0a0a"
                strokeWidth={1.5}
              />
              <text
                x={lx}
                y={ly + 3}
                fill="#a3a3a3"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
                letterSpacing="0.05em"
                textAnchor={anchor}
              >
                <a href={`/entities/${node.id}`}>{node.id}</a>
              </text>
            </g>
          );
        })}

        {/* center node */}
        <circle cx={CENTER} cy={CENTER} r={20} fill="#0a0a0a" stroke="#7dd3fc" strokeWidth={1.5} />
        <text
          x={CENTER}
          y={CENTER + 4}
          textAnchor="middle"
          fill="#fafafa"
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          letterSpacing="0.05em"
        >
          {primary}
        </text>
      </svg>

      {/* legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {presentTypes.map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: TYPE_COLOR[t] }}
              aria-hidden
            />
            {t} <span className="nums text-zinc-600">{groups.get(t)?.length ?? 0}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
