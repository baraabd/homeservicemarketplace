// recharts 2.15 ships class components whose internal `Component<P, S>`
// shape no longer satisfies the stricter `ComponentClass<P>` constraint
// that @types/react 18.3.28+ enforces on JSX class elements. Until recharts
// publishes a matching type patch, widen every exported symbol to a loose
// functional-component signature so tsc accepts the JSX usage in
// AdminDashboard / ProviderApp / chart.tsx. Runtime behavior is unchanged.
//
// This file is purely a type shim — no runtime code is emitted.

declare module 'recharts' {
  import type { FC, PropsWithChildren } from 'react';

  type AnyProps = PropsWithChildren<Record<string, unknown>>;

  export const Area: FC<AnyProps>;
  export const AreaChart: FC<AnyProps>;
  export const Bar: FC<AnyProps>;
  export const BarChart: FC<AnyProps>;
  export const CartesianGrid: FC<AnyProps>;
  export const Cell: FC<AnyProps>;
  export const ComposedChart: FC<AnyProps>;
  export const Cross: FC<AnyProps>;
  export const Customized: FC<AnyProps>;
  export const Dot: FC<AnyProps>;
  export const ErrorBar: FC<AnyProps>;
  export const Funnel: FC<AnyProps>;
  export const FunnelChart: FC<AnyProps>;
  export const Label: FC<AnyProps>;
  export const LabelList: FC<AnyProps>;
  export const Legend: FC<AnyProps>;
  export const Line: FC<AnyProps>;
  export const LineChart: FC<AnyProps>;
  export const Pie: FC<AnyProps>;
  export const PieChart: FC<AnyProps>;
  export const PolarAngleAxis: FC<AnyProps>;
  export const PolarGrid: FC<AnyProps>;
  export const PolarRadiusAxis: FC<AnyProps>;
  export const Radar: FC<AnyProps>;
  export const RadarChart: FC<AnyProps>;
  export const RadialBar: FC<AnyProps>;
  export const RadialBarChart: FC<AnyProps>;
  export const Rectangle: FC<AnyProps>;
  export const ReferenceArea: FC<AnyProps>;
  export const ReferenceDot: FC<AnyProps>;
  export const ReferenceLine: FC<AnyProps>;
  export const ResponsiveContainer: FC<AnyProps>;
  export const Sankey: FC<AnyProps>;
  export const Scatter: FC<AnyProps>;
  export const ScatterChart: FC<AnyProps>;
  export const Sector: FC<AnyProps>;
  export const Surface: FC<AnyProps>;
  export const Text: FC<AnyProps>;
  export const Tooltip: FC<AnyProps>;
  export const Treemap: FC<AnyProps>;
  export const Trapezoid: FC<AnyProps>;
  export const XAxis: FC<AnyProps>;
  export const YAxis: FC<AnyProps>;
  export const ZAxis: FC<AnyProps>;
}
