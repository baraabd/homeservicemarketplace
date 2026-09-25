// Compatibility declarations retained for the existing Recharts JSX call sites.
// Tooltip and Legend must preserve the installed library's actual props: the
// former Record<string, unknown> declaration erased payload arrays, callback
// signatures and labelClassName, and did not export LegendProps at all.
//
// Import props from the installed 2.x declaration subpaths rather than from
// this shadowed root module. These are type-only imports, not browser imports.
// Runtime components and the pinned dependency version are unchanged.

declare module 'recharts' {
  import type { FC, PropsWithChildren, ReactElement } from 'react';
  import type { TooltipProps as NativeTooltipProps } from 'recharts/types/component/Tooltip';
  import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
  import type { Props as NativeLegendProps } from 'recharts/types/component/Legend';

  type AnyProps = PropsWithChildren<Record<string, unknown>>;

  export type TooltipProps<TValue extends ValueType, TName extends NameType> = NativeTooltipProps<
    TValue,
    TName
  >;
  export type LegendProps = NativeLegendProps;

  // Keep Tooltip generic so existing formatter callbacks can infer their value
  // and name types, while ComponentProps<typeof Tooltip> retains typed payloads.
  export function Tooltip<TValue extends ValueType = ValueType, TName extends NameType = NameType>(
    props: TooltipProps<TValue, TName>,
  ): ReactElement | null;
  export const Legend: FC<LegendProps>;

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
  export const Treemap: FC<AnyProps>;
  export const Trapezoid: FC<AnyProps>;
  export const XAxis: FC<AnyProps>;
  export const YAxis: FC<AnyProps>;
  export const ZAxis: FC<AnyProps>;
}
