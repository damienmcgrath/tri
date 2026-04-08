import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
        }}
      >
        <svg
          width="80"
          height="70"
          viewBox="0 0 80 70"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <polygon
            points="40,2 4,66 76,66"
            stroke="#beff00"
            strokeWidth="4"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <div
          style={{
            display: "flex",
            marginTop: 8,
            fontSize: 28,
            fontWeight: 700,
            color: "#beff00",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Tri
          <span
            style={{
              color: "rgba(255,255,255,0.65)",
              fontWeight: 400,
              fontSize: 20,
              marginTop: 6,
              marginLeft: 1,
            }}
          >
            .AI
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
