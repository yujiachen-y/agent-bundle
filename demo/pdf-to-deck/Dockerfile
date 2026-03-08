FROM e2bdev/base:latest

RUN mkdir -p /workspace && chmod 777 /workspace

# Python deps for pdf skill
RUN pip install --no-cache-dir \
    pypdf pdfplumber reportlab pypdfium2 Pillow pandas

# Python deps for pptx skill
RUN pip install --no-cache-dir \
    'markitdown[pptx]' defusedxml

# Node.js deps for pptx skill (PptxGenJS creation)
RUN npm install -g pptxgenjs

# System tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    qpdf \
    fonts-dejavu \
    fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*
