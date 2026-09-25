import type { ComponentProps } from 'react';
import type { Legend, LegendProps, Tooltip, TooltipProps } from 'recharts';
import type { Props as NativeLegendProps } from 'recharts/types/component/Legend';
import type { TooltipProps as NativeTooltipProps } from 'recharts/types/component/Tooltip';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

// This is a .ts file, not a .d.ts or an excluded *.test.ts file. The normal
// tsc -b build must check these assertions even with skipLibCheck enabled.
// It is not imported by the browser and introduces no runtime dependency.
type Assert<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type PublicTooltipProps = ComponentProps<typeof Tooltip>;
type ExpectedTooltipProps = NativeTooltipProps<ValueType, NameType>;

export type RechartsCompatibilityTypeChecks = [
  Assert<Equal<PublicTooltipProps['payload'], ExpectedTooltipProps['payload']>>,
  Assert<Equal<IsAny<PublicTooltipProps['payload']>, false>>,
  Assert<Equal<PublicTooltipProps['labelClassName'], string | undefined>>,
  Assert<Equal<PublicTooltipProps['formatter'], ExpectedTooltipProps['formatter']>>,
  Assert<Equal<PublicTooltipProps['labelFormatter'], ExpectedTooltipProps['labelFormatter']>>,
  Assert<Equal<TooltipProps<number, string>, NativeTooltipProps<number, string>>>,
  Assert<Equal<LegendProps, NativeLegendProps>>,
  Assert<Equal<ComponentProps<typeof Legend>, NativeLegendProps>>,
  Assert<Equal<IsAny<LegendProps['payload']>, false>>,
];
