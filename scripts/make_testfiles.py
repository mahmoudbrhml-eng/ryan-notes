#!/usr/bin/env python3
"""Generate test files for Ryan Notes PDF tools e2e verification."""
import os
from PIL import Image

OUT = "/home/z/my-project/testfiles"
os.makedirs(OUT, exist_ok=True)

# ---------- 1) PDFs via reportlab ----------
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

def make_pdf(path, pages, title, color):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    for i in range(1, pages + 1):
        c.setFillColorRGB(*color)
        c.setFont("Helvetica-Bold", 42)
        c.drawString(60, h - 140, title)
        c.setFont("Helvetica", 90)
        c.drawCentredString(w / 2, h / 2, f"Page {i}")
        c.setFont("Helvetica", 16)
        c.drawString(60, 60, f"{title} — page {i} of {pages} — generated for e2e testing")
        c.showPage()
    c.save()

make_pdf(f"{OUT}/doc-a.pdf", 3, "Document A", (0.04, 0.44, 0.41))
make_pdf(f"{OUT}/doc-b.pdf", 2, "Document B", (0.66, 0.28, 0.13))
make_pdf(f"{OUT}/multipage.pdf", 8, "Multipage", (0.23, 0.31, 0.55))
print("PDFs done")

# ---------- 2) images ----------
img1 = Image.new("RGB", (800, 600), (240, 244, 248))
for x in range(0, 800, 40):
    for y in range(0, 600, 40):
        if (x // 40 + y // 40) % 2 == 0:
            for dx in range(20):
                for dy in range(20):
                    img1.putpixel((x + dx, y + dy), (11, 111, 105))
img1.save(f"{OUT}/photo-1.png")

img2 = Image.new("RGB", (600, 800), (255, 244, 214))
px = img2.load()
for i in range(600):
    px[i, i * 800 // 600] = (200, 90, 30)
    px[i, 799 - i * 800 // 600] = (200, 90, 30)
img2.save(f"{OUT}/photo-2.jpg", quality=90)

# JPEG with EXIF orientation 6 (rotated 90°) to test EXIF handling
img3 = Image.new("RGB", (1200, 500), (60, 60, 90))
from PIL import ImageDraw
d = ImageDraw.Draw(img3)
d.text((30, 220), "EXIF ORIENTATION TEST - 90CW", fill=(255, 255, 255))
img3.save(f"{OUT}/photo-3-rot.jpg", quality=90, exif=b"Exif\x00\x00II*\x00\x08\x00\x00\x00\x01\x00\x12\x01\x06\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00")
print("images done")

# ---------- 3) DOCX (Arabic + table + headings) ----------
from docx import Document
from docx.shared import Pt

doc = Document()
doc.add_heading("ملخص محاضرة الجهاز التنفسي", level=1)
doc.add_paragraph("ده ملخص تجريبي للتأكد من دعم اللغة العربية في تحويل ملفات الوورد لـ PDF داخل Ryan Notes.")
doc.add_heading("Respiratory System Overview", level=2)
doc.add_paragraph("The respiratory system includes the airways, lungs, and respiratory muscles. Pneumothorax means air in the pleural space.")
doc.add_paragraph("فقرة عربية تانية للتأكد من ترتيب الكلمات من اليمين للشمال لما تتوجه في ملف الـ PDF النهائي.", style=None)
doc.add_heading("مقارنة الحالات", level=2)
table = doc.add_table(rows=1, cols=3)
hdr = table.rows[0].cells
hdr[0].text = "الحالة"
hdr[1].text = "العَرَض الرئيسي"
hdr[2].text = "العلامة المميزة"
cases = [
    ("Pneumothorax", "Chest pain, dyspnea", "Absent breath sounds"),
    ("Pleural effusion", "Dyspnea", "Stony dull percussion"),
    ("Consolidation", "Fever, cough", "Bronchial breathing"),
    ("Atelectasis", "Low O2", "Tracheal shift"),
    ("Embolism", "Sudden dyspnea", "S1Q3T3 on ECG"),
    ("Empyema", "Fever", "Pleural fluid pH < 7.2"),
    ("Fibrosis", "Dry cough", "Fine end-inspiratory crackles"),
    ("Edema", "Orthopnea", "Bilateral crackles"),
    ("Tumor", "Weight loss", "Hemoptysis"),
    ("TB", "Night sweats", "Upper lobe cavity"),
    ("Asthma", "Wheeze", "Reversible obstruction"),
    ("COPD", "Chronic cough", "FEV1/FVC < 0.7"),
]
for r in cases:
    row = table.add_row().cells
    for i, val in enumerate(r):
        row[i].text = val
doc.add_heading("نقاط مهمة", level=3)
for item in ["⭐ سؤال الامتحان بييجي من الجدول ده", "الـ Pneumothorax التوتري حالة طارئة", "راجع أشعة الصدر قبل المحاضرة الجاية"]:
    doc.add_paragraph(item, style="List Bullet")
doc.save(f"{OUT}/محاضرة-الجهاز-التنفسي.docx")
print("docx done")

# ---------- 4) PPTX (3 slides: Arabic, bullets, table) ----------
from pptx import Presentation
from pptx.util import Inches, Pt as PPt

prs = Presentation()
s1 = prs.slides.add_slide(prs.slide_layouts[0])
s1.shapes.title.text = "أمراض الصدر Chest Diseases"
s1.placeholders[1].text = "د. ريان — محاضرة تجريبية للاختبار"

s2 = prs.slides.add_slide(prs.slide_layouts[1])
s2.shapes.title.text = "Learning Objectives"
tf = s2.placeholders[1].text_frame
for i, b in enumerate(["Define pneumothorax and its types", "تمييز الانصباب عن التكثيف على الأشعة", "Interpret pleural fluid analysis", "Management of tension pneumothorax"]):
    p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    p.text = b
    p.font.size = PPt(24)

s3 = prs.slides.add_slide(prs.slide_layouts[5])
s3.shapes.title.text = "جدول مقارنة"
rows, cols = 4, 3
tbl = s3.shapes.add_table(rows, cols, Inches(0.8), Inches(1.8), Inches(8), Inches(3.5)).table
heads = ["الحالة", "Finding", "Action"]
for j, htxt in enumerate(heads):
    tbl.cell(0, j).text = htxt
data = [("PTX", "Hyperlucency", "Chest tube"), ("Effusion", "Meniscus sign", "Thoracocentesis"), ("Consolidation", "Air bronchogram", "Antibiotics")]
for i, rowdata in enumerate(data, start=1):
    for j, val in enumerate(rowdata):
        tbl.cell(i, j).text = val
prs.save(f"{OUT}/محاضرة-الصدر.pptx")
print("pptx done")

import os
for f in sorted(os.listdir(OUT)):
    print(f"{f:40s} {os.path.getsize(os.path.join(OUT, f)):>9,} bytes")
