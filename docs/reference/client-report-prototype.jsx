import { useState, useRef, useEffect } from "react";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from "recharts";

// ─── Report Data (Summit Medical Academy - Client Projection) ──────────────
const REPORT = {
  client: "Summit Medical Academy",
  domain: "summitmedicalacademy.co",
  period: "March 20, 2026 — April 28, 2026",
  generatedAt: "April 28, 2026",
  summary: {
    totalKeywords: 70,
    avgDelta: 0,
    improved: 0,
    declined: 0,
    topicAuthority: 7.9,
    aiMentionsGoogle: 3,
    aiMentionsChatGPT: 0,
    aiKeywordsTracked: 13,
  },
  executiveSummary: [
    "Baseline tracking is now active across 70 keywords and 13 topic clusters. This is the initial measurement period — movement data will appear in the next reporting cycle.",
    "Three Google AI Overview mentions detected at baseline, with your domain cited alongside established institutions like NIC, ISU, and Idaho Works.",
    "Eight clusters contain keywords already ranking in positions 11–30, representing near-term opportunity to move onto page one with targeted content.",
    "GA4 behavioral data collection is active for published pages. Conversion rate and engagement metrics will populate as traffic data accumulates.",
  ],
  rankingMovement: {
    isBaseline: true,
    periodLabel: "Baseline → Current",
    topMovers: [],
    topDecliners: [],
    distribution: { improved: 0, unchanged: 70, declined: 0, newlyRanked: 0, droppedOff: 0 },
  },
  nearMiss: [
    { keyword: "emt training boise idaho", rank: 11, volume: 110, estRevenue: "$1,200–$2,400", cluster: "Idaho Medical Academy" },
    { keyword: "idaho medical academy reviews", rank: 15, volume: 90, estRevenue: "$980–$1,960", cluster: "Idaho Medical Academy" },
    { keyword: "benefits of emt", rank: 16, volume: 210, estRevenue: "$2,280–$4,560", cluster: "EMT Basic Course" },
    { keyword: "northwest emt", rank: 17, volume: 50, estRevenue: "$540–$1,080", cluster: "EMT Basic Course" },
    { keyword: "in the ambulance", rank: 21, volume: 1300, estRevenue: "$4,100–$8,200", cluster: "EMT Career & Cert" },
    { keyword: "summit ems", rank: 21, volume: 70, estRevenue: "$760–$1,520", cluster: "Idaho Medical Academy" },
    { keyword: "naemt scholarships", rank: 23, volume: 90, estRevenue: "$980–$1,960", cluster: "NAEMT Scholarships" },
    { keyword: "emt idaho", rank: 24, volume: 90, estRevenue: "$980–$1,960", cluster: "EMT Career & Cert" },
    { keyword: "emt certification idaho", rank: 26, volume: 260, estRevenue: "$2,820–$5,640", cluster: "EMT Career & Cert" },
    { keyword: "ear injuries in dogs", rank: 29, volume: 90, estRevenue: "—", cluster: "Off-topic" },
  ],
  clusters: [
    { topic: "Idaho Medical Academy", keywords: 8, avgPos: 38.5, p1_3: 2, p4_10: 0, p11_30: 3, volume: 2030, authority: 33.1, trend: "baseline" },
    { topic: "EMT Basic Course", keywords: 47, avgPos: 48.3, p1_3: 0, p4_10: 4, p11_30: 3, volume: 159370, authority: 7.8, trend: "baseline" },
    { topic: "NREMT Test Prep", keywords: 6, avgPos: 61.8, p1_3: 0, p4_10: 0, p11_30: 1, volume: 15260, authority: 4.2, trend: "baseline" },
    { topic: "CPR Training", keywords: 12, avgPos: 78.7, p1_3: 0, p4_10: 0, p11_30: 0, volume: 93430, authority: 1.3, trend: "baseline" },
    { topic: "Advanced EMT (AEMT)", keywords: 18, avgPos: 56.6, p1_3: 1, p4_10: 0, p11_30: 1, volume: 9170, authority: 7.5, trend: "baseline" },
    { topic: "EMT Career & Certification", keywords: 9, avgPos: 56.9, p1_3: 0, p4_10: 1, p11_30: 1, volume: 2230, authority: 13.9, trend: "baseline" },
    { topic: "NAEMT Scholarships", keywords: 3, avgPos: 31.0, p1_3: 0, p4_10: 0, p11_30: 2, volume: 170, authority: 8.3, trend: "baseline" },
    { topic: "EMT Continuing Education", keywords: 8, avgPos: null, p1_3: 0, p4_10: 0, p11_30: 0, volume: 7100, authority: 0.0, trend: "baseline" },
    { topic: "Healthcare Education", keywords: 4, avgPos: 87.8, p1_3: 0, p4_10: 0, p11_30: 0, volume: 820, authority: 1.3, trend: "baseline" },
    { topic: "Medical Assistant Programs", keywords: 2, avgPos: 78.5, p1_3: 0, p4_10: 0, p11_30: 0, volume: 60, authority: 5.8, trend: "baseline" },
    { topic: "Medication Aide Certification", keywords: 1, avgPos: 84.0, p1_3: 0, p4_10: 0, p11_30: 0, volume: 30, authority: 5.8, trend: "baseline" },
    { topic: "Pharmacy Technician", keywords: 2, avgPos: 68.5, p1_3: 0, p4_10: 0, p11_30: 0, volume: 130, authority: 5.8, trend: "baseline" },
    { topic: "Phlebotomy Training", keywords: 2, avgPos: 69.5, p1_3: 0, p4_10: 0, p11_30: 0, volume: 260, authority: 3.8, trend: "baseline" },
  ],
  siteTraffic: {
    hasData: true,
    gsc: { totalClicks: 487, totalImpressions: 28400, avgCtr: 1.71, avgPosition: 42.3 },
    ga4: { organicSessions: 312, engagedSessions: 198, engagementRate: 63.5, keyEvents: 14, newUsers: 267, avgSessionDuration: 94 },
    trends: {
      "30d": [
        { date: "Mar 23", clicks: 98, impressions: 5800, sessions: 62, engaged: 38, keyEvents: 2, newUsers: 54 },
        { date: "Mar 30", clicks: 112, impressions: 6400, sessions: 71, engaged: 44, keyEvents: 3, newUsers: 61 },
        { date: "Apr 6", clicks: 124, impressions: 7200, sessions: 82, engaged: 53, keyEvents: 4, newUsers: 70 },
        { date: "Apr 13", clicks: 118, impressions: 6800, sessions: 78, engaged: 50, keyEvents: 3, newUsers: 66 },
        { date: "Apr 20", clicks: 135, impressions: 7600, sessions: 89, engaged: 58, keyEvents: 4, newUsers: 76 },
      ],
      "90d": [
        { date: "Feb 2", clicks: 64, impressions: 4100, sessions: 41, engaged: 22, keyEvents: 1, newUsers: 35 },
        { date: "Feb 9", clicks: 71, impressions: 4400, sessions: 45, engaged: 26, keyEvents: 1, newUsers: 38 },
        { date: "Feb 16", clicks: 68, impressions: 4200, sessions: 43, engaged: 24, keyEvents: 1, newUsers: 37 },
        { date: "Feb 23", clicks: 78, impressions: 4800, sessions: 49, engaged: 29, keyEvents: 2, newUsers: 42 },
        { date: "Mar 2", clicks: 82, impressions: 5100, sessions: 52, engaged: 31, keyEvents: 2, newUsers: 44 },
        { date: "Mar 9", clicks: 89, impressions: 5500, sessions: 56, engaged: 34, keyEvents: 2, newUsers: 48 },
        { date: "Mar 16", clicks: 91, impressions: 5600, sessions: 58, engaged: 35, keyEvents: 2, newUsers: 49 },
        { date: "Mar 23", clicks: 98, impressions: 5800, sessions: 62, engaged: 38, keyEvents: 2, newUsers: 54 },
        { date: "Mar 30", clicks: 112, impressions: 6400, sessions: 71, engaged: 44, keyEvents: 3, newUsers: 61 },
        { date: "Apr 6", clicks: 124, impressions: 7200, sessions: 82, engaged: 53, keyEvents: 4, newUsers: 70 },
        { date: "Apr 13", clicks: 118, impressions: 6800, sessions: 78, engaged: 50, keyEvents: 3, newUsers: 66 },
        { date: "Apr 20", clicks: 135, impressions: 7600, sessions: 89, engaged: 58, keyEvents: 4, newUsers: 76 },
      ],
    },
  },
  aiVisibility: {
    googleMentions: 3, chatgptMentions: 0, keywordsTracked: 13,
    citingDomains: [
      "www.nic.edu", "cetrain.isu.edu", "www.idahomedicalacademy.com",
      "www.emt-national-training.com", "emtprep.com",
      "www.healthcarepathway.com", "idahoworks.gov", "workforce.csi.edu"
    ],
  },
  publishedPages: [],
};

// ─── Design Tokens ──────────────────────────────────────────────────────────
const T = {
  bg: "#0C0F14",
  surface: "#141820",
  surfaceRaised: "#1A1F2A",
  border: "#252B38",
  text: "#E8E4DD",
  textDim: "#8A8F9C",
  textMuted: "#5C6170",
  accent: "#C47F3A",
  accentLight: "#D4994E",
  accentDim: "rgba(196, 127, 58, 0.12)",
  green: "#3A9E6E",
  greenDim: "rgba(58, 158, 110, 0.12)",
  red: "#C45A4A",
  redDim: "rgba(196, 90, 74, 0.12)",
  blue: "#4A8FC4",
  blueDim: "rgba(74, 143, 196, 0.12)",
  purple: "#8A6ABF",
  teal: "#3A9E9E",
  font: "'DM Sans', sans-serif",
  fontMono: "'DM Mono', monospace",
  radius: "8px",
};

const getAuthorityTier = (score) => {
  if (score >= 70) return { label: "Dominant", color: T.green };
  if (score >= 40) return { label: "Strong", color: T.blue };
  if (score >= 15) return { label: "Building", color: T.accent };
  return { label: "Low", color: T.textMuted };
};

const getPositionColor = (pos) => {
  if (pos === null) return T.textMuted;
  if (pos <= 3) return T.green;
  if (pos <= 10) return T.blue;
  if (pos <= 30) return T.accent;
  return T.textMuted;
};

const cardStyle = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: T.radius,
  padding: "28px",
  marginBottom: "20px",
};

const sectionLabel = {
  fontFamily: T.fontMono, fontSize: "11px", letterSpacing: "1.5px",
  textTransform: "uppercase", color: T.accent, marginBottom: "8px",
};

const sectionTitle = {
  fontFamily: T.font, fontSize: "20px", fontWeight: 600,
  color: T.text, marginBottom: "6px", lineHeight: 1.3,
};

const sectionDesc = {
  fontFamily: T.font, fontSize: "14px", color: T.textDim,
  lineHeight: 1.6, marginBottom: "24px",
};

// ─── Info Bubble Component ──────────────────────────────────────────────────
function InfoBubble({ text, width = 280 }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState("bottom");
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (visible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setPosition(spaceBelow < 200 ? "top" : "bottom");
    }
  }, [visible]);

  return (
    <span
      ref={triggerRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: "6px", cursor: "help" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(!visible)}
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ display: "block" }}>
        <circle cx="7.5" cy="7.5" r="6.5" stroke={T.textMuted} strokeWidth="1" fill="none" />
        <text x="7.5" y="11" textAnchor="middle" fontSize="9" fontFamily={T.fontMono} fontWeight="600" fill={T.textMuted}>i</text>
      </svg>
      {visible && (
        <div
          ref={tooltipRef}
          style={{
            position: "absolute",
            [position === "bottom" ? "top" : "bottom"]: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: `${width}px`,
            background: T.surfaceRaised,
            border: `1px solid ${T.border}`,
            borderRadius: "8px",
            padding: "14px 16px",
            zIndex: 100,
            boxShadow: `0 8px 32px rgba(0,0,0,0.4)`,
          }}
        >
          {/* Arrow */}
          <div style={{
            position: "absolute",
            [position === "bottom" ? "top" : "bottom"]: "-5px",
            left: "50%", transform: "translateX(-50%) rotate(45deg)",
            width: "10px", height: "10px",
            background: T.surfaceRaised,
            border: `1px solid ${T.border}`,
            [position === "bottom" ? "borderBottom" : "borderTop"]: "none",
            [position === "bottom" ? "borderRight" : "borderLeft"]: "none",
          }} />
          <div style={{
            fontFamily: T.font, fontSize: "12px", lineHeight: 1.6,
            color: T.textDim, position: "relative", zIndex: 1,
          }}>
            {text}
          </div>
        </div>
      )}
    </span>
  );
}

// ─── Metric Explanations ────────────────────────────────────────────────────
const INFO = {
  authority: "Topic Authority measures your site's visibility strength for a given topic cluster, scored 0–100. It's calculated from: the number of keywords ranking in top positions, your average rank vs. competitors for those keywords, and the search volume you're capturing. Higher scores mean search engines treat your site as a credible source for that topic.",
  nearMiss: "Near-miss keywords are search terms where your site ranks in positions 11–30 (page 2–3 of Google). These represent the highest-leverage opportunities because they require the least effort to move onto page one, where the majority of clicks happen.",
  clusterPerformance: "Each topic cluster groups related keywords that search engines associate together. Improving your authority in one keyword within a cluster often lifts the others. The position buckets (P1–3, P4–10, P11–30) show how your keywords are distributed across search result pages.",
  aiVisibility: "AI Visibility tracks how often your brand is mentioned or cited in AI-generated search results (Google AI Overviews, ChatGPT). As more searches shift to AI-powered answers, appearing in these results becomes an increasingly important visibility channel.",
  engagedSessions: "Engaged sessions are visits where the user either stayed for 10+ seconds, triggered a conversion event, or viewed 2+ pages. This filters out bounces and low-quality visits, giving a clearer picture of meaningful traffic.",
  keyEvents: "Key events (formerly conversions) are specific actions visitors take on your site that have business value, such as form submissions, phone calls, or enrollment sign-ups. These are configured in GA4.",
  estRevenue: "Revenue estimates model what each keyword could generate annually if moved to positions 1–3. The calculation uses: average click-through rates for top positions, industry-specific conversion rates for vocational/trade education, and estimated average customer value. Shown as a range to reflect conversion rate variability.",
  gscClicks: "Search clicks from Google Search Console represent actual clicks from Google search results to your site. Unlike GA4 sessions (which count site visits), GSC clicks count the search-to-site action specifically.",
  ctr: "Click-through rate is the percentage of people who see your site in search results and actually click. Higher CTR means your titles and descriptions are compelling relative to competitors on the same results page.",
  movementDistribution: "Movement distribution shows how many of your tracked keywords improved, declined, or held steady compared to the previous reporting period. Net movement (improved minus declined) indicates overall directional momentum.",
};

// ─── Components ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color, delta, deltaLabel, info }) {
  return (
    <div style={{
      background: T.surfaceRaised, border: `1px solid ${T.border}`,
      borderRadius: T.radius, padding: "20px", flex: "1 1 0", minWidth: "140px",
    }}>
      <div style={{
        fontFamily: T.fontMono, fontSize: "11px", letterSpacing: "1px",
        textTransform: "uppercase", color: T.textDim, marginBottom: "10px",
        display: "flex", alignItems: "center",
      }}>
        {label}
        {info && <InfoBubble text={info} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
        <div style={{ fontFamily: T.font, fontSize: "28px", fontWeight: 700, color: color || T.text, lineHeight: 1 }}>
          {value}
        </div>
        {delta !== undefined && delta !== null && delta !== 0 && (
          <div style={{
            fontFamily: T.fontMono, fontSize: "12px", fontWeight: 600,
            color: delta > 0 ? T.green : T.red,
            display: "flex", alignItems: "center", gap: "2px",
          }}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta)}{deltaLabel || ""}
          </div>
        )}
      </div>
      {sub && <div style={{ fontFamily: T.font, fontSize: "12px", color: T.textMuted, marginTop: "6px" }}>{sub}</div>}
    </div>
  );
}

function AuthorityBadge({ score }) {
  const tier = getAuthorityTier(score);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "3px 10px", borderRadius: "4px",
      background: `${tier.color}18`, border: `1px solid ${tier.color}30`,
      fontFamily: T.fontMono, fontSize: "12px", color: tier.color, fontWeight: 500,
    }}>
      {score.toFixed(1)}
      <span style={{ fontSize: "10px", opacity: 0.7 }}>{tier.label}</span>
    </span>
  );
}

function PositionBadge({ position }) {
  if (position === null) return <span style={{ color: T.textMuted, fontFamily: T.fontMono, fontSize: "13px" }}>--</span>;
  return <span style={{ fontFamily: T.fontMono, fontSize: "13px", fontWeight: 600, color: getPositionColor(position) }}>{position}</span>;
}

function DeltaBadge({ delta }) {
  if (delta === null || delta === undefined || delta === 0)
    return <span style={{ fontFamily: T.fontMono, fontSize: "12px", color: T.textMuted }}>--</span>;
  const pos = delta > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      padding: "2px 8px", borderRadius: "4px",
      background: pos ? T.greenDim : T.redDim,
      fontFamily: T.fontMono, fontSize: "12px", fontWeight: 600, color: pos ? T.green : T.red,
    }}>
      {pos ? "↑" : "↓"}{Math.abs(delta)}
    </span>
  );
}

function PeriodSelector({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", gap: "3px", background: T.surfaceRaised, borderRadius: "6px", padding: "3px", border: `1px solid ${T.border}` }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          fontFamily: T.fontMono, fontSize: "11px", letterSpacing: "0.5px",
          padding: "6px 14px", borderRadius: "4px", border: "none",
          background: value === opt.value ? T.accentDim : "transparent",
          color: value === opt.value ? T.accentLight : T.textMuted,
          cursor: "pointer", transition: "all 0.15s ease",
          fontWeight: value === opt.value ? 600 : 400,
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

function DataTable({ columns, data, emptyMessage }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: T.font }}>
        <thead><tr>
          {columns.map((col, i) => (
            <th key={i} style={{
              textAlign: col.align || "left", padding: "10px 14px",
              fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px",
              textTransform: "uppercase", color: T.textMuted,
              borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap", fontWeight: 500,
            }}>
              <span style={{ display: "inline-flex", alignItems: "center" }}>
                {col.label}
                {col.info && <InfoBubble text={col.info} width={260} />}
              </span>
            </th>
          ))}
        </tr></thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ padding: "32px 14px", textAlign: "center", color: T.textDim, fontSize: "14px" }}>{emptyMessage || "No data available"}</td></tr>
          ) : data.map((row, i) => (
            <tr key={i}>
              {columns.map((col, j) => (
                <td key={j} style={{
                  textAlign: col.align || "left", padding: "12px 14px", fontSize: "13px", color: T.text,
                  borderBottom: i < data.length - 1 ? `1px solid ${T.border}40` : "none",
                }}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionDivider() {
  return <div style={{ height: "1px", background: `linear-gradient(90deg, transparent, ${T.border}, transparent)`, margin: "12px 0" }} />;
}

// ─── Ranking Movement ───────────────────────────────────────────────────────
function RankingMovementSection({ data }) {
  const dist = data.distribution;
  const distData = [
    { name: "Improved", value: dist.improved, color: T.green },
    { name: "Unchanged", value: dist.unchanged, color: T.textMuted },
    { name: "Declined", value: dist.declined, color: T.red },
  ];
  if (dist.newlyRanked > 0) distData.push({ name: "Newly Ranked", value: dist.newlyRanked, color: T.blue });
  if (dist.droppedOff > 0) distData.push({ name: "Dropped Off", value: dist.droppedOff, color: T.red });
  const total = distData.reduce((s, d) => s + d.value, 0);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: "0" }}>
        <div style={sectionLabel}>Ranking Movement</div>
      </div>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
        Keyword Position Changes
        <InfoBubble text={INFO.movementDistribution} width={300} />
      </div>
      <div style={sectionDesc}>
        {data.isBaseline
          ? "This is the baseline measurement period. All 70 keywords have been captured at their starting positions. Movement tracking begins with the next snapshot cycle."
          : `Position changes across ${total} tracked keywords from ${data.periodLabel}.`}
      </div>

      <div style={{ marginBottom: "24px" }}>
        <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.textMuted, marginBottom: "12px" }}>
          Movement Distribution
        </div>
        <div style={{ display: "flex", height: "32px", borderRadius: "6px", overflow: "hidden", border: `1px solid ${T.border}` }}>
          {distData.filter(d => d.value > 0).map((d, i) => (
            <div key={i} style={{
              flex: d.value, background: `${d.color}30`,
              borderRight: i < distData.filter(x => x.value > 0).length - 1 ? `1px solid ${T.bg}` : "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              minWidth: d.value / total > 0.08 ? "auto" : "0",
            }}>
              {d.value / total > 0.08 && (
                <span style={{ fontFamily: T.fontMono, fontSize: "11px", color: d.color, fontWeight: 600 }}>{d.value}</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: "20px", marginTop: "10px", flexWrap: "wrap" }}>
          {distData.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: d.color }} />
              <span style={{ fontFamily: T.fontMono, fontSize: "11px", color: T.textDim }}>{d.name}: {d.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
        <MetricCard label="Improved" value={dist.improved} color={dist.improved > 0 ? T.green : T.textMuted} sub="Moved up" />
        <MetricCard label="Declined" value={dist.declined} color={dist.declined > 0 ? T.red : T.textMuted} sub="Moved down" />
        <MetricCard label="Net Movement" value={data.isBaseline ? "--" : `${dist.improved - dist.declined > 0 ? "+" : ""}${dist.improved - dist.declined}`} sub="Improved minus declined" />
        <MetricCard label="Avg Delta" value={data.isBaseline ? "--" : REPORT.summary.avgDelta.toFixed(1)} sub="Positions" />
      </div>

      {!data.isBaseline && data.topMovers.length > 0 && (
        <>
          <SectionDivider />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "20px" }}>
            <div>
              <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.green, marginBottom: "12px" }}>Top Movers</div>
              <DataTable
                columns={[
                  { label: "Keyword", key: "keyword", render: (r) => <span style={{ fontWeight: 500 }}>{r.keyword}</span> },
                  { label: "Delta", key: "delta", align: "right", render: (r) => <DeltaBadge delta={r.delta} /> },
                ]}
                data={data.topMovers}
              />
            </div>
            <div>
              <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.red, marginBottom: "12px" }}>Largest Declines</div>
              <DataTable
                columns={[
                  { label: "Keyword", key: "keyword", render: (r) => <span style={{ fontWeight: 500 }}>{r.keyword}</span> },
                  { label: "Delta", key: "delta", align: "right", render: (r) => <DeltaBadge delta={r.delta} /> },
                ]}
                data={data.topDecliners}
              />
            </div>
          </div>
        </>
      )}

      {data.isBaseline && (
        <div style={{
          textAlign: "center", padding: "28px 20px",
          background: T.surfaceRaised, borderRadius: T.radius, border: `1px dashed ${T.border}`,
        }}>
          <div style={{ fontSize: "14px", color: T.textDim }}>Baseline period -- movement data begins next cycle</div>
          <div style={{ fontSize: "12px", color: T.textMuted, marginTop: "6px" }}>
            Top movers and decliners will appear here with position deltas and volume-weighted impact
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Site Traffic ───────────────────────────────────────────────────────────
function SiteTrafficSection({ data }) {
  const [period, setPeriod] = useState("30d");
  const [activeMetric, setActiveMetric] = useState("sessions");

  const periodOptions = [
    { value: "30d", label: "30 Days" },
    { value: "90d", label: "90 Days" },
    { value: "6m", label: "6 Months" },
    { value: "12m", label: "12 Months" },
  ];

  const metricOptions = [
    { id: "sessions", label: "Sessions", key: "sessions", color: T.blue },
    { id: "engaged", label: "Engaged", key: "engaged", color: T.green },
    { id: "keyEvents", label: "Key Events", key: "keyEvents", color: T.accent },
    { id: "newUsers", label: "New Users", key: "newUsers", color: T.teal },
    { id: "clicks", label: "GSC Clicks", key: "clicks", color: T.purple },
  ];

  const trendData = data.trends[period] || data.trends["30d"];
  const currentMetric = metricOptions.find(m => m.id === activeMetric);
  const hasLongerData = period === "6m" || period === "12m";

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "12px 16px", fontFamily: T.font }}>
        <div style={{ fontSize: "12px", color: T.textDim, marginBottom: "6px" }}>{label}</div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: payload[0].color }}>
          {payload[0].value.toLocaleString()} {currentMetric.label.toLowerCase()}
        </div>
      </div>
    );
  };

  const formatDuration = (secs) => `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "8px" }}>
        <div>
          <div style={sectionLabel}>Site Traffic</div>
          <div style={sectionTitle}>Organic Performance</div>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} options={periodOptions} />
      </div>
      <div style={sectionDesc}>
        Organic search traffic and engagement metrics from Google Search Console and GA4.
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
        <MetricCard label="Organic Sessions" value={data.ga4.organicSessions.toLocaleString()} sub="From GA4" color={T.blue} />
        <MetricCard label="Engaged Sessions" value={data.ga4.engagedSessions.toLocaleString()} sub={`${data.ga4.engagementRate}% rate`} color={T.green} info={INFO.engagedSessions} />
        <MetricCard label="Key Events" value={data.ga4.keyEvents} sub="Conversions" color={T.accent} info={INFO.keyEvents} />
        <MetricCard label="New Users" value={data.ga4.newUsers.toLocaleString()} sub="First visits" color={T.teal} />
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "28px" }}>
        <MetricCard label="GSC Clicks" value={data.gsc.totalClicks.toLocaleString()} sub="Search clicks" color={T.purple} info={INFO.gscClicks} />
        <MetricCard label="Impressions" value={data.gsc.totalImpressions.toLocaleString()} sub="Search appearances" />
        <MetricCard label="CTR" value={`${data.gsc.avgCtr}%`} sub="Click-through rate" info={INFO.ctr} />
        <MetricCard label="Avg Session Duration" value={formatDuration(data.ga4.avgSessionDuration)} sub="Minutes:seconds" />
      </div>

      <div style={{ marginBottom: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.textMuted }}>Trend</div>
          <div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>
            {metricOptions.map(m => (
              <button key={m.id} onClick={() => setActiveMetric(m.id)} style={{
                fontFamily: T.fontMono, fontSize: "10px", padding: "4px 10px",
                borderRadius: "4px", border: `1px solid ${activeMetric === m.id ? m.color + "60" : T.border}`,
                background: activeMetric === m.id ? m.color + "15" : "transparent",
                color: activeMetric === m.id ? m.color : T.textMuted,
                cursor: "pointer", transition: "all 0.15s ease",
              }}>{m.label}</button>
            ))}
          </div>
        </div>

        {hasLongerData ? (
          <div style={{
            textAlign: "center", padding: "48px 20px",
            background: T.surfaceRaised, borderRadius: T.radius, border: `1px dashed ${T.border}`,
          }}>
            <div style={{ fontSize: "14px", color: T.textDim }}>Insufficient data for {period === "6m" ? "6-month" : "12-month"} trends</div>
            <div style={{ fontSize: "12px", color: T.textMuted, marginTop: "6px" }}>Tracking began March 20, 2026. This view will populate as data accumulates.</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={currentMetric.color} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={currentMetric.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.fontMono }} axisLine={{ stroke: T.border }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.fontMono }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey={currentMetric.key} stroke={currentMetric.color} strokeWidth={2} fill="url(#areaGrad)"
                dot={{ r: 4, fill: currentMetric.color, stroke: T.bg, strokeWidth: 2 }}
                activeDot={{ r: 6, fill: currentMetric.color, stroke: T.bg, strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ─── Cluster Chart ──────────────────────────────────────────────────────────
function ClusterDistributionChart({ clusters }) {
  const sorted = [...clusters].sort((a, b) => b.volume - a.volume).slice(0, 8);
  const data = sorted.map(c => ({
    name: c.topic.length > 20 ? c.topic.slice(0, 18) + "..." : c.topic,
    fullName: c.topic, keywords: c.keywords, authority: c.authority, volume: c.volume,
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: T.surfaceRaised, border: `1px solid ${T.border}`, borderRadius: "6px", padding: "12px 16px", fontFamily: T.font }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: T.text, marginBottom: "6px" }}>{d.fullName}</div>
        <div style={{ fontSize: "12px", color: T.textDim }}>{d.keywords} keywords | Authority: {d.authority}</div>
        <div style={{ fontSize: "12px", color: T.accent, marginTop: "2px" }}>{d.volume.toLocaleString()} monthly searches</div>
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 40, left: 8 }} barSize={28}>
        <CartesianGrid strokeDasharray="3 3" stroke={T.border} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.fontMono }} angle={-35} textAnchor="end" interval={0} axisLine={{ stroke: T.border }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: T.textMuted, fontFamily: T.fontMono }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: T.accentDim }} />
        <Bar dataKey="volume" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.authority >= 15 ? T.accent : entry.authority >= 5 ? T.accentLight + "80" : T.textMuted + "60"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── AI Visibility ──────────────────────────────────────────────────────────
function AiVisibilityChart() {
  const data = [
    { name: "Google AI", value: 3, color: T.blue },
    { name: "ChatGPT", value: 0, color: T.purple },
  ];
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "40px", flexWrap: "wrap" }}>
      <div style={{ width: "120px", height: "120px", position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={total > 0 ? data.filter(d => d.value > 0) : [{ value: 1, color: T.border }]}
              cx="50%" cy="50%" innerRadius={38} outerRadius={55} dataKey="value" strokeWidth={0}>
              {(total > 0 ? data.filter(d => d.value > 0) : [{ color: T.border }]).map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
          <div style={{ fontFamily: T.font, fontSize: "22px", fontWeight: 700, color: T.text }}>{total}</div>
          <div style={{ fontFamily: T.fontMono, fontSize: "9px", color: T.textMuted, letterSpacing: "0.5px" }}>MENTIONS</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: d.color, flexShrink: 0 }} />
            <div>
              <div style={{ fontFamily: T.font, fontSize: "13px", color: T.text }}>{d.name}</div>
              <div style={{ fontFamily: T.fontMono, fontSize: "12px", color: T.textDim }}>{d.value} mention{d.value !== 1 ? "s" : ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Report ────────────────────────────────────────────────────────────
export default function SummitReport() {
  const [activeSection, setActiveSection] = useState("all");

  const sections = [
    { id: "all", label: "Full Report" },
    { id: "summary", label: "Summary" },
    { id: "traffic", label: "Traffic" },
    { id: "rankings", label: "Rankings" },
    { id: "opportunities", label: "Opportunities" },
    { id: "clusters", label: "Topic Health" },
    { id: "ai", label: "AI Visibility" },
  ];

  const show = (id) => activeSection === "all" || activeSection === id;
  const clustersWithOpp = REPORT.clusters.filter(c => c.p1_3 > 0 || c.p4_10 > 0 || c.p11_30 > 0);
  const totalOppVolume = REPORT.nearMiss.reduce((s, k) => s + k.volume, 0);

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: T.font, color: T.text }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: `linear-gradient(135deg, ${T.surface} 0%, ${T.bg} 100%)`,
        borderBottom: `1px solid ${T.border}`, padding: "40px 32px 32px",
      }}>
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
            <div>
              <div style={{ ...sectionLabel, marginBottom: "12px" }}>Performance Report</div>
              <h1 style={{ fontFamily: T.font, fontSize: "28px", fontWeight: 700, color: T.text, margin: "0 0 6px", lineHeight: 1.2 }}>{REPORT.client}</h1>
              <div style={{ fontFamily: T.fontMono, fontSize: "13px", color: T.textDim }}>{REPORT.domain}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: T.font, fontSize: "13px", color: T.textDim }}>{REPORT.period}</div>
              <div style={{ fontFamily: T.fontMono, fontSize: "11px", color: T.textMuted, marginTop: "4px" }}>Generated {REPORT.generatedAt}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: "4px", marginTop: "28px", flexWrap: "wrap" }}>
            {sections.map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
                fontFamily: T.fontMono, fontSize: "11px", letterSpacing: "0.8px",
                textTransform: "uppercase", padding: "8px 16px", borderRadius: "6px",
                border: `1px solid ${activeSection === s.id ? T.accent : T.border}`,
                background: activeSection === s.id ? T.accentDim : "transparent",
                color: activeSection === s.id ? T.accentLight : T.textDim,
                cursor: "pointer", transition: "all 0.15s ease",
              }}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: "960px", margin: "0 auto", padding: "28px 32px 60px" }}>

        {/* Executive Summary */}
        {show("summary") && (
          <div style={cardStyle}>
            <div style={sectionLabel}>Executive Summary</div>
            <div style={sectionTitle}>Baseline Established</div>
            <div style={{ ...sectionDesc, marginBottom: "20px" }}>
              This is the initial reporting period. All metrics below represent starting positions against which future progress will be measured.
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "24px" }}>
              <MetricCard label="Keywords Tracked" value={REPORT.summary.totalKeywords} sub="Across 13 clusters" />
              <MetricCard label="Topic Authority" value={REPORT.summary.topicAuthority.toFixed(1)} sub="Avg across clusters" color={getAuthorityTier(REPORT.summary.topicAuthority).color} info={INFO.authority} />
              <MetricCard label="AI Mentions" value={REPORT.summary.aiMentionsGoogle} sub="Google AI Overviews" color={T.blue} info={INFO.aiVisibility} />
              <MetricCard label="Near-Miss Keywords" value={REPORT.nearMiss.length} sub="Positions 11–30" color={T.accent} info={INFO.nearMiss} />
            </div>

            <SectionDivider />

            <div style={{ marginTop: "20px" }}>
              <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.textMuted, marginBottom: "14px" }}>Key Findings</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {REPORT.executiveSummary.map((item, i) => (
                  <div key={i} style={{
                    display: "flex", gap: "14px", alignItems: "flex-start",
                    padding: "12px 16px", background: T.surfaceRaised,
                    borderRadius: "6px", border: `1px solid ${T.border}40`,
                  }}>
                    <div style={{
                      width: "22px", height: "22px", borderRadius: "50%",
                      background: T.accentDim, border: `1px solid ${T.accent}30`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: T.fontMono, fontSize: "11px", color: T.accent, flexShrink: 0, marginTop: "1px",
                    }}>{i + 1}</div>
                    <div style={{ fontSize: "13px", lineHeight: 1.6, color: T.textDim }}>{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Site Traffic */}
        {show("traffic") && <SiteTrafficSection data={REPORT.siteTraffic} />}

        {/* Ranking Movement */}
        {show("rankings") && <RankingMovementSection data={REPORT.rankingMovement} />}

        {/* Opportunity Pipeline */}
        {show("opportunities") && (
          <div style={cardStyle}>
            <div style={sectionLabel}>Opportunity Pipeline</div>
            <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
              Near-Miss Keywords
              <InfoBubble text={INFO.nearMiss} width={300} />
            </div>
            <div style={sectionDesc}>
              Keywords ranking in positions 11–30 with the highest potential revenue impact if moved to page one.
            </div>

            <div style={{ display: "flex", gap: "12px", marginBottom: "24px", flexWrap: "wrap" }}>
              <MetricCard label="Near-Miss Keywords" value={REPORT.nearMiss.length} />
              <MetricCard label="Combined Volume" value={totalOppVolume.toLocaleString()} sub="Monthly searches" />
              <MetricCard label="Clusters with Opportunity" value={clustersWithOpp.length} sub={`of ${REPORT.clusters.length} total`} />
            </div>

            <DataTable
              columns={[
                { label: "Keyword", key: "keyword", render: (r) => <span style={{ fontWeight: 500 }}>{r.keyword}</span> },
                { label: "Cluster", key: "cluster", render: (r) => (
                  <span style={{ fontFamily: T.fontMono, fontSize: "11px", color: T.textDim, padding: "2px 8px", background: T.surfaceRaised, borderRadius: "3px" }}>{r.cluster}</span>
                )},
                { label: "Position", key: "rank", align: "center", render: (r) => <PositionBadge position={r.rank} /> },
                { label: "Volume", key: "volume", align: "right", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px" }}>{r.volume.toLocaleString()}</span> },
                { label: "Est. Annual Revenue", key: "estRevenue", align: "right", info: INFO.estRevenue, render: (r) => (
                  <span style={{ fontFamily: T.fontMono, fontSize: "13px", color: r.estRevenue === "—" ? T.textMuted : T.green }}>{r.estRevenue}</span>
                )},
              ]}
              data={REPORT.nearMiss}
            />
            <div style={{ fontFamily: T.font, fontSize: "12px", color: T.textMuted, marginTop: "14px", lineHeight: 1.5 }}>
              Revenue estimates based on position 1–3 CTR benchmarks, industry conversion rates for vocational/trade education, and estimated average enrollment value.
            </div>
          </div>
        )}

        {/* Cluster Health */}
        {show("clusters") && (
          <div style={cardStyle}>
            <div style={sectionLabel}>Topic Health</div>
            <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
              Cluster Performance
              <InfoBubble text={INFO.clusterPerformance} width={320} />
            </div>
            <div style={sectionDesc}>
              Each cluster represents a topic area your site competes in. Authority score reflects your current visibility strength relative to competitors.
            </div>

            <div style={{ marginBottom: "28px" }}>
              <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.textMuted, marginBottom: "16px" }}>
                Search Volume by Topic
              </div>
              <ClusterDistributionChart clusters={REPORT.clusters} />
            </div>

            <DataTable
              columns={[
                { label: "Topic", key: "topic", render: (r) => <span style={{ fontWeight: 500, fontSize: "13px" }}>{r.topic}</span> },
                { label: "Keywords", key: "keywords", align: "center", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px" }}>{r.keywords}</span> },
                { label: "Avg Pos", key: "avgPos", align: "center", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px", color: r.avgPos ? T.textDim : T.textMuted }}>{r.avgPos ? r.avgPos.toFixed(1) : "--"}</span> },
                { label: "P1–3", key: "p1_3", align: "center", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px", color: r.p1_3 > 0 ? T.green : T.textMuted }}>{r.p1_3}</span> },
                { label: "P4–10", key: "p4_10", align: "center", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px", color: r.p4_10 > 0 ? T.blue : T.textMuted }}>{r.p4_10}</span> },
                { label: "P11–30", key: "p11_30", align: "center", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px", color: r.p11_30 > 0 ? T.accent : T.textMuted }}>{r.p11_30}</span> },
                { label: "Volume", key: "volume", align: "right", render: (r) => <span style={{ fontFamily: T.fontMono, fontSize: "13px" }}>{r.volume.toLocaleString()}</span> },
                { label: "Authority", key: "authority", align: "center", info: INFO.authority, render: (r) => <AuthorityBadge score={r.authority} /> },
              ]}
              data={REPORT.clusters}
            />

            {/* Authority Scale Legend */}
            <div style={{
              display: "flex", gap: "16px", marginTop: "18px", padding: "14px 18px",
              background: T.surfaceRaised, borderRadius: "6px", border: `1px solid ${T.border}40`,
              flexWrap: "wrap", alignItems: "center",
            }}>
              <span style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: T.textMuted }}>Authority Scale:</span>
              {[
                { range: "0–14", label: "Low", color: T.textMuted },
                { range: "15–39", label: "Building", color: T.accent },
                { range: "40–69", label: "Strong", color: T.blue },
                { range: "70–100", label: "Dominant", color: T.green },
              ].map((tier, i) => (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span style={{
                    width: "8px", height: "8px", borderRadius: "2px",
                    background: `${tier.color}40`, border: `1px solid ${tier.color}60`,
                  }} />
                  <span style={{ fontFamily: T.fontMono, fontSize: "11px", color: tier.color }}>
                    {tier.range} {tier.label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI Visibility */}
        {show("ai") && (
          <div style={cardStyle}>
            <div style={sectionLabel}>AI Visibility</div>
            <div style={{ ...sectionTitle, display: "flex", alignItems: "center" }}>
              AI Search Presence
              <InfoBubble text={INFO.aiVisibility} width={320} />
            </div>
            <div style={sectionDesc}>
              How often your brand appears in AI-generated search results across Google AI Overviews and ChatGPT.
            </div>

            <div style={{ display: "flex", gap: "32px", flexWrap: "wrap", marginBottom: "28px" }}>
              <AiVisibilityChart />
              <div style={{ flex: "1 1 300px" }}>
                <div style={{ fontFamily: T.fontMono, fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase", color: T.textMuted, marginBottom: "14px" }}>
                  Domains Citing Your Keywords
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {REPORT.aiVisibility.citingDomains.map((d, i) => (
                    <span key={i} style={{
                      fontFamily: T.fontMono, fontSize: "11px", padding: "5px 10px", borderRadius: "4px",
                      background: d.includes("idahomedicalacademy") ? T.accentDim : T.surfaceRaised,
                      border: `1px solid ${d.includes("idahomedicalacademy") ? T.accent + "40" : T.border}`,
                      color: d.includes("idahomedicalacademy") ? T.accentLight : T.textDim,
                    }}>{d}</span>
                  ))}
                </div>
                <div style={{ fontFamily: T.font, fontSize: "12px", color: T.textMuted, marginTop: "14px", lineHeight: 1.5 }}>
                  Your domain is highlighted. Competitor domains appearing alongside yours indicate shared topical relevance in AI results.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Published Pages */}
        {show("summary") && (
          <div style={cardStyle}>
            <div style={sectionLabel}>Content Impact</div>
            <div style={sectionTitle}>Published Page Performance</div>
            <div style={sectionDesc}>
              Tracking begins when pages are marked as published. Once live, this section shows ranking impact, traffic, engagement, and conversions per page.
            </div>
            <div style={{
              textAlign: "center", padding: "40px 20px",
              background: T.surfaceRaised, borderRadius: T.radius, border: `1px dashed ${T.border}`,
            }}>
              <div style={{ fontSize: "14px", color: T.textDim }}>No published pages yet</div>
              <div style={{ fontSize: "12px", color: T.textMuted, marginTop: "8px", opacity: 0.6 }}>
                GA4 behavioral metrics (sessions, engagement, conversions) will appear here alongside ranking data
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: "20px", padding: "24px 0", borderTop: `1px solid ${T.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px",
        }}>
          <div>
            <div style={{ fontFamily: T.font, fontSize: "14px", fontWeight: 600, color: T.text }}>Forge Growth</div>
            <div style={{ fontFamily: T.fontMono, fontSize: "11px", color: T.textMuted, marginTop: "2px" }}>AI-Powered Search Marketing Intelligence</div>
          </div>
          <div style={{ fontFamily: T.fontMono, fontSize: "11px", color: T.textMuted }}>forgegrowth.ai</div>
        </div>
      </div>
    </div>
  );
}
