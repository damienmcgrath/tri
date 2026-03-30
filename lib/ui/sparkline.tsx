type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
};

export function Sparkline({
  values,
  width = 120,
  height = 32,
  color = "hsl(var(--accent))",
  className
}: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 2;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * plotWidth;
    const y = padding + plotHeight - ((v - min) / range) * plotHeight;
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={points[points.length - 1].split(",")[0]}
        cy={points[points.length - 1].split(",")[1]}
        r={2.5}
        fill={color}
      />
    </svg>
  );
}
