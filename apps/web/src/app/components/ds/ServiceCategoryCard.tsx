import { ReactNode } from "react";

export interface ServiceCategoryCardProps {
  icon:       ReactNode;
  label:      string;
  iconBg?:    string;  // Tailwind bg class  e.g. "bg-blue-100"
  iconColor?: string;  // Tailwind text class e.g. "text-blue-600"
  badge?:     string;
  onClick?:   () => void;
  selected?:  boolean;
}

export function ServiceCategoryCard({
  icon,
  label,
  iconBg    = "bg-amber-100",
  iconColor = "text-amber-600",
  badge,
  onClick,
  selected  = false,
}: ServiceCategoryCardProps) {
  return (
    <button
      onClick={onClick}
      className={[
        "relative flex flex-col items-center justify-center gap-3",
        "p-4 rounded-3xl border transition-all duration-150 active:scale-95",
        selected
          ? "border-amber-500 bg-amber-50 shadow-md shadow-amber-100"
          : "border-slate-100 bg-white shadow-sm hover:shadow-md hover:border-slate-200",
      ].join(" ")}
      style={{ aspectRatio: "1 / 1" }}
    >
      {/* Badge */}
      {badge && (
        <span
          className="absolute top-2.5 end-2.5 bg-red-500 text-white rounded-full px-1.5 leading-4"
          style={{ fontSize: "9px", fontWeight: 700 }}
        >
          {badge}
        </span>
      )}

      {/* Selected ring */}
      {selected && (
        <span className="absolute top-2.5 start-2.5 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}

      {/* Icon container — 48×48px (4px grid: 12 units) */}
      <div
        className={[
          "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-150",
          selected ? "bg-amber-500" : iconBg,
        ].join(" ")}
      >
        <span className={selected ? "text-white" : iconColor}>
          {icon}
        </span>
      </div>

      {/* Label */}
      <span
        className={selected ? "text-amber-700" : "text-slate-700"}
        style={{ fontSize: "12px", fontWeight: 600, lineHeight: "1.3", textAlign: "center" }}
      >
        {label}
      </span>
    </button>
  );
}
