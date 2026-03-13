from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import BaseDocTemplate, Frame, FrameBreak, PageTemplate, Paragraph, Spacer


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs"
PDF_PATH = OUTPUT_DIR / "tri-app-summary.pdf"


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="TitleSmall",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=20,
            leading=24,
            textColor=colors.HexColor("#0f172a"),
            spaceAfter=6,
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Deck",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=12.5,
            textColor=colors.HexColor("#334155"),
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionHead",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=12,
            textColor=colors.HexColor("#0f766e"),
            spaceBefore=2,
            spaceAfter=4,
            uppercase=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyCompact",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.7,
            leading=11,
            textColor=colors.HexColor("#111827"),
            spaceAfter=5,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletCompact",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=10.5,
            leftIndent=10,
            firstLineIndent=-7,
            bulletIndent=0,
            textColor=colors.HexColor("#111827"),
            spaceAfter=2,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MiniNote",
            parent=styles["BodyText"],
            fontName="Helvetica-Oblique",
            fontSize=7.6,
            leading=9.2,
            textColor=colors.HexColor("#475569"),
            spaceBefore=3,
            spaceAfter=0,
        )
    )
    return styles


def build_story(styles):
    story = [
        Paragraph("TriCoach AI", styles["TitleSmall"]),
        Paragraph(
            "One-page repo summary built from code, docs, routes, and migrations in this repository.",
            styles["Deck"],
        ),
        Paragraph("What It Is", styles["SectionHead"]),
        Paragraph(
            "TriCoach AI is a web app for amateur triathletes that combines training plans, weekly progress views, activity ingestion, and an AI coaching workspace. "
            "Repo evidence shows authenticated dashboard, plan, calendar, coach, settings, and activity detail surfaces backed by Supabase.",
            styles["BodyCompact"],
        ),
        Paragraph("Who It's For", styles["SectionHead"]),
        Paragraph(
            "Primary persona: self-coached or cost-conscious amateur triathletes training for Sprint, Olympic, 70.3, or Ironman races.",
            styles["BodyCompact"],
        ),
        Paragraph("What It Does", styles["SectionHead"]),
    ]

    feature_bullets = [
        "Creates and edits multi-week training plans, weeks, and sessions.",
        "Shows dashboard progress with planned vs completed weekly minutes by sport.",
        "Displays a weekly calendar with planned, completed, skipped, and next-session cues.",
        "Uploads and parses <b>.fit</b> and <b>.tcx</b> activity files into completed activities.",
        "Links uploaded activities to planned sessions and flags unmatched uploads for review.",
        "Provides coach chat, execution review, and coach briefing flows using athlete-scoped data.",
        "Captures durable athlete context plus a weekly check-in for fatigue, sleep, soreness, stress, and confidence.",
    ]
    for item in feature_bullets:
        story.append(Paragraph(item, styles["BulletCompact"], bulletText="-"))

    story.extend(
        [
            Paragraph(
                "Direct Garmin Health API sync: <b>Not found in repo</b>. Current implemented bridge is manual file upload.",
                styles["MiniNote"],
            ),
            FrameBreak(),
            Paragraph("How It Works", styles["SectionHead"]),
            Paragraph(
                "Browser requests pass through Next.js 14 App Router middleware for auth gating and security headers. Protected UI routes and server actions call request-scoped Supabase clients for Auth and Postgres data under RLS. "
                "Route handlers cover coach chat, uploads, upload attachment, athlete context/check-in, and health. Domain logic lives mainly in <b>lib/coach</b> (instructions, tools, handlers, audit), <b>lib/workouts</b> (FIT/TCX parsing, matching, execution), <b>lib/training</b> (session semantics, week metrics), <b>lib/security</b> (origin checks, rate limiting), and <b>lib/openai.ts</b> (server-side model selection). "
                "Coach chat persists context in Supabase and calls the OpenAI Responses API; <b>.env.example</b> names <b>gpt-5-mini</b> and <b>gpt-5.4</b> for coaching models.",
                styles["BodyCompact"],
            ),
            Paragraph("How To Run", styles["SectionHead"]),
        ]
    )

    run_bullets = [
        "Install deps: <b>npm ci</b>",
        "Create <b>.env.local</b> from <b>.env.example</b>; required vars include <b>NEXT_PUBLIC_SUPABASE_URL</b> and a Supabase publishable or anon key.",
        "Apply Supabase migrations: <b>supabase link --project-ref &lt;ref&gt;</b> then <b>supabase db push</b>",
        "Enable Supabase email/password auth for local sign-in.",
        "Start the app: <b>npm run dev</b> and open <b>http://localhost:3000</b>",
    ]
    for item in run_bullets:
        story.append(Paragraph(item, styles["BulletCompact"], bulletText="-"))

    story.append(
        Paragraph(
            "Minimal local startup commands are documented in README. Production deployment steps are <b>Not found in repo</b>.",
            styles["MiniNote"],
        )
    )
    return story


def add_page_chrome(canvas, doc):
    canvas.saveState()
    width, height = letter
    canvas.setStrokeColor(colors.HexColor("#cbd5e1"))
    canvas.setFillColor(colors.HexColor("#f8fafc"))
    canvas.roundRect(0.45 * inch, 0.45 * inch, width - 0.9 * inch, height - 0.9 * inch, 12, stroke=1, fill=1)
    canvas.setFillColor(colors.HexColor("#0f172a"))
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(width - 0.58 * inch, 0.58 * inch, "Repo summary | 1 page")
    canvas.restoreState()


def build_pdf():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    page_width, page_height = letter
    gutter = 0.26 * inch
    usable_width = page_width - (0.72 * inch * 2)
    column_width = (usable_width - gutter) / 2
    frame_height = page_height - 1.32 * inch

    left = Frame(0.72 * inch, 0.78 * inch, column_width, frame_height, leftPadding=0.16 * inch, rightPadding=0.14 * inch, topPadding=0.16 * inch, bottomPadding=0.12 * inch, showBoundary=0)
    right = Frame(0.72 * inch + column_width + gutter, 0.78 * inch, column_width, frame_height, leftPadding=0.14 * inch, rightPadding=0.16 * inch, topPadding=0.16 * inch, bottomPadding=0.12 * inch, showBoundary=0)

    doc = BaseDocTemplate(
        str(PDF_PATH),
        pagesize=letter,
        leftMargin=0,
        rightMargin=0,
        topMargin=0,
        bottomMargin=0,
        title="TriCoach AI Repo Summary",
        author="Codex",
    )
    doc.addPageTemplates([PageTemplate(id="TwoCol", frames=[left, right], onPage=add_page_chrome)])
    doc.build(build_story(build_styles()))


if __name__ == "__main__":
    build_pdf()
    print(PDF_PATH)
