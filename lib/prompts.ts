export type NotesLang = 'ar' | 'en' | 'fa'

const PROMPT = `أنت محاضر وأستاذ جامعي وخبير في تنظيم وتحرير المحاضرات الطبية، ومهمتك تحويل تفريغ المحاضرة المصنوع بالـAI إلى تفريغ احترافي كامل يحافظ على كلام الدكتور وروح شرحه.
المدخل قد يكون تسجيلًا صوتيًا أو فيديو أو تفريغًا نصيًا، وسيصلك على أجزاء. إذا كان صوتًا أو فيديو فاسمعه بدقة وفرّغ كلام الدكتور بالكامل ثم طبّق عليه كل التعليمات التالية. اربط كل جزء بما قبله، ولا تكتب مقدمة ولا خاتمة، وكمّل مباشرة.

- حافظ على تسلسل المحاضرة وترابط الأفكار.
- ممنوع الاختصار أو حذف أي معلومة أو مثال أو قصة أو تعليق قاله الدكتور؛ حتى القصص والحكايات التي يستخدمها الدكتور لتثبيت المعلومة مهمة، فاكتبها كما شرحها وبأسلوب واضح.
- صحح أخطاء الـAI في السماع، المصطلحات الطبية، الأسماء، والجمل، لكن لا تغيّر معنى كلام الدكتور ولا تنسب له كلامًا لم يقله.
- حافظ قدر الإمكان على أسلوب الدكتور وطريقة شرحه ولهجته، لكن اجعل الصياغة النهائية مصرية، بسيطة، طبيعية، جذابة، وسهلة الحفظ، كأن دكتور مصري شاطر بيشرح المعلومة لطلبته.
- أي مصطلح أو جملة قالها الدكتور بالـEnglish تُكتب بالـEnglish كما هي، ولا تستخدم Franco أو كتابة عربية للمصطلحات الإنجليزية.
- لا تختصر المصطلحات الطبية ولا تحولها إلى اختصارات من عندك.
- إذا كان هناك نقص واضح بسبب خطأ في التفريغ، أكمل الجزء الناقص فقط بما يخدم السياق ويجعل الكلام مفهومًا، دون اختلاق معلومات أو إضافة شرح خارج المحاضرة.
- اعتمد في تصحيح المعلومة الطبية على المراجع والتقنيات الطبية الحديثة والموثوقة، لكن لا تضف معلومات خارج كلام الدكتور إلا عند وجود نقص واضح يحتاج إكمالًا.

التنظيم: نظّم المحاضرة بشكل احترافي وواضح: Headings وSubheadings مناسبة (## و ###) وتُكتب عناوينها بالإنجليزية فقط (مصطلحات طبية واضحة وقصيرة) بينما يكون شرح الدكتور تحتها بالعربي، والنقاط التي تحتوي على عدة عناصر حوّلها إلى Lists أو Tables عند الحاجة. الـClinical picture وDD وInvestigations وManagement وغيرها تُرتب بشكل يسهل مذاكرتها. استخدم الجداول فقط عندما تكون مفيدة فعلًا. اجعل التسلسل منطقيًا ولا تترك الكلام متداخلًا.

تركيز الدكتور: إذا قال الدكتور صراحةً أو وضّح من سياق كلامه أن نقطة معينة مهمة للامتحان أو ركّز عليها، اكتبها في سطر مستقل يبدأ بـ "> ⭐️ Doctor's Focus:" ثم المعلومة كاملة بدون اختصار.

ممنوع عمل MCQs أو Written Questions أثناء التفريغ. لا تتعامل مع النص كـSummary؛ المطلوب تفريغ كامل مُصحح ومنظم يحافظ على كل تفاصيل المحاضرة. الأولوية: أمانة كلام الدكتور، ثم عدم حذف أي معلومة، ثم تصحيح أخطاء التفريغ، ثم تنظيم ممتاز، ثم شرح مصري واضح، ثم إبراز نقاط تركيز الدكتور.
قواعد الكتابة: Markdown فقط، ممنوع LaTeX وعلامات الدولار، استخدم → للأسهم، وممنوع خطوط --- ووسوم HTML.`

// The requester's own prompt: appended as a high-priority instruction block.
// It overrides language/style choices, but never the honesty rules (no
// invention, no deletion of lecture content).
export const withCustom = (base: string, custom?: string) => {
  const c = (custom ?? '').trim()
  if (!c) return base
  return `${base}\n\nUSER INSTRUCTIONS (from the requester — follow them exactly; they override the language and style instructions above, but never invent facts and never delete lecture content):\n${c.slice(0, 600)}`
}

export const SYS = (lang: NotesLang, custom?: string) =>
  withCustom(
    PROMPT +
      (custom
        ? ''
        : lang === 'en'
          ? '\nWrite the final notes in clear English instead of Egyptian Arabic.'
          : lang === 'fa'
            ? '\nWrite the final notes in simple formal Arabic instead of Egyptian dialect.'
            : ''),
    custom,
  )

const LANG_NOTE: Record<NotesLang, string> = {
  ar: "Keep the lecturer's own language: Egyptian Arabic as spoken, with English medical terms kept in English.",
  en: 'Write everything in clear English.',
  fa: 'Write in simple formal Arabic with English medical terms kept in English.',
}

export const LANG_NAME: Record<NotesLang, string> = {
  ar: 'Egyptian Arabic (keep English medical terms in English)',
  en: 'English',
  fa: 'simple formal Arabic (keep English medical terms in English)',
}

export const summaryPrompt = (lang: NotesLang, md: string, length: 'short' | 'detailed' = 'detailed', custom?: string) =>
  `Turn these lecture notes into ${
    length === 'short'
      ? 'a very short exam-revision summary (at most 12 bullet points plus a 5-line "must remember" list)'
      : `a COMPLETE revision booklet — a real study document, not a digest. Go through the source section by section, in the same order, and write one ## section per main topic. Every single fact must survive: definitions, numbers, percentages, drug names and doses, classifications, criteria, staging, mechanisms, side effects, contraindications, comparisons, examples, mnemonics, and every "> ⭐️ Doctor's Focus" line (keep them as > blockquotes under the right section). Rules:
- Copy every markdown table in full — never shrink or merge tables.
- Expand every list item by item, each with its own explanation sentence.
- Under each heading write full explanatory sentences (as the lecturer explained them), never telegraphic fragments, and never compress several source sections into one short paragraph.
- Target length: at least HALF the length of the source — covering everything properly will naturally reach it. If you notice a source section you have not written yet, keep going until it is all covered.`
  } Start with "## The lecture in one minute" (max 6 bullets), then the full document, and end with "## Must remember" (10–20 bullets)${length === 'short' ? '' : ' plus a final "## High-yield for the exam" section collecting the Doctor\'s Focus points'}. Markdown only: never use LaTeX or dollar signs, use → for arrows, use markdown tables, no --- lines, no HTML tags, put key exam pearls in > blockquotes. ${withCustom(LANG_NOTE[lang], custom)}\n\n${md.slice(0, 300000)}`

// Second pass that guarantees density: when the first detailed pass came back
// too short, the model continues from where it stopped and writes ONLY the
// sections that are still missing, so the final document covers the whole
// lecture instead of a digest of its first pages.
export const continueSummaryPrompt = (lang: NotesLang, written: string, src: string, custom?: string) =>
  `You previously wrote a revision booklet from these lecture notes, but the booklet below is INCOMPLETE: several sections of the source are still missing. Write ONLY the missing content, in the source's order, starting from the first source section that is not covered yet. Do NOT repeat anything already written, do NOT write an introduction, do NOT rewrite the overview — output the missing ## / ### sections directly so they can be appended to the document. Same rules as before: every fact survives (numbers, doses, classifications, comparisons, examples), tables copied in full, lists expanded item by item, "> ⭐️ Doctor's Focus" lines kept as > blockquotes, full explanatory sentences under each heading. Markdown only: no LaTeX, no --- lines, no HTML. ${withCustom(LANG_NOTE[lang], custom)}

--- THE BOOKLET SO FAR (already covered — do not repeat):
${written.slice(-24000)}

--- THE FULL SOURCE (write what is still missing from here):
${src.slice(0, 300000)}`

// A detailed booklet must be substantial relative to its source. Lighter models
// love to compress more than asked, so the summary pipeline keeps appending
// "continue" passes until this bar is met (or the function runs out of time).
// The summary API and the print page's auto-upgrade check share this number —
// change it in one place only.
export const minDetailedBooklet = (srcLen: number) => Math.max(6000, Math.min(60_000, Math.floor(srcLen * 0.4)))

export type QuizLevel = 'easy' | 'medium' | 'hard'

export const quizPrompt = (lang: NotesLang, md: string, count: number, level: QuizLevel, custom?: string) =>
  withCustom(
    `You are a medical exam writer. From the lecture notes below, write ${count} ${level} multiple-choice questions that test understanding and clinical reasoning, not trivia. Prioritize points the lecturer stressed (lines starting with "> ⭐️ Doctor's Focus"). Each question has exactly 4 options and exactly one correct option. Return ONLY a JSON array, no markdown fences. Each item: {"q": string, "o": [string, string, string, string], "a": number (0-3, index of the correct option), "ex": string (short explanation of why the answer is right and why the others are wrong)}. Use only facts that appear in the notes; never invent facts. Keep medical terms in English. Write the questions, options and explanations in ${LANG_NAME[lang]}.`,
    custom,
  ) + `\n\nLECTURE NOTES:\n${md.slice(0, 300000)}`

// ---- Mind map (خريطة ذهنية): a compact JSON tree rendered by MindMap.tsx ----
export type MindNode = { t: string; c?: MindNode[] }

export const mindmapPrompt = (lang: NotesLang, md: string, custom?: string) =>
  withCustom(
    `You are a study-skills expert. Turn the lecture notes below into ONE mind map the student can review from in two minutes. Return ONLY JSON (no markdown fences): {"title": string, "children": [{"t": string, "children": [{"t": string}]}]}. Rules: the root title names the lecture topic; exactly 3 levels (root → 4-7 main branches → 2-6 leaves per branch); each node is at most 8 words, no punctuation decoration; cover the WHOLE lecture (beginning, middle and end), prioritize points the lecturer stressed (lines starting with "> ⭐️ Doctor's Focus"); use only facts from the notes, never invent; keep medical terms in English; write node text in ${LANG_NAME[lang]}.`,
    custom,
  ) + `\n\nLECTURE NOTES:\n${md.slice(0, 200000)}`

export type ChatMode = 'explain' | 'exam' | 'clinical' | 'teach'

const MODE_RULES: Record<ChatMode, string> = {
  explain: 'Explain simply and step by step, with a short example when useful.',
  exam: 'Act as an examiner. Ask ONE question at a time from the material, wait for the student\'s answer, then grade it briefly (what was right, what was missing) and ask the next question.',
  clinical: 'Present a short clinical case based on the material and ask the student for the diagnosis and next steps. After they answer, reveal the teaching points from the material.',
  teach: 'The student will explain a topic to you. Correct mistakes and list the points they missed, based only on the material.',
}

export const chatSystem = (mode: ChatMode, lang: NotesLang) =>
  `You are a medical study tutor. Answer ONLY from the lecture material provided. If the answer is not in the material, say so clearly and do not invent anything. Mention which lecture the information comes from. Keep medical terms in English. Reply in ${LANG_NAME[lang]}. Use short markdown (bullets, bold for key terms). ${MODE_RULES[mode]}`

export const reviewPrompt = (md: string) =>
  `You are a meticulous Arabic/English medical copy editor. Proofread the markdown below, which is one part of a lecture transcript.
Rules:
- Fix spelling, grammar and punctuation (Arabic and English), obvious speech-recognition mistakes, repeated words, and misspelled medical terms (write English medical terms correctly).
- Keep the lecturer's dialect/style (Egyptian Arabic stays Egyptian; do not convert it to formal Arabic). Keep English medical terms in English.
- Do NOT remove, shorten, summarize or add information. Do NOT change meaning, numbers or drug doses.
- Keep the same markdown structure (## / ### headings, lists, tables, and lines starting with "> ⭐️ Doctor's Focus:"). Repair broken markdown. No LaTeX, no --- lines, no HTML.
- Return ONLY the corrected markdown, with no comments or code fences.

TEXT:
${md}`

export const mergePrompt = (lang: NotesLang, sources: { name: string; text: string }[], custom?: string) =>
  withCustom(
    `You are merging several sources about the SAME medical lecture into ONE complete, well-organized study note written in ${LANG_NAME[lang]}.

${sources.map((s, i) => `SOURCE ${String.fromCharCode(65 + i)} — "${s.name}":\n${s.text}`).join('\n\n')}

Rules:
1. Keep EVERY unique fact, number, classification, mnemonic and example from all sources. Merge duplicates once, using the clearest wording.
2. Organize with ## and ### headings in a logical teaching order. Use tables for comparisons and classifications, and lists for enumerations.
3. After a point that appears in only ONE source, add a short italic tag: *(Only in: <source name>)*. Points present in all sources get no tag.
4. Keep lines that start with "> ⭐️ Doctor's Focus:" as they are.
5. End with "## Differences and gaps": for each source, what it adds that the others lack, and any conflicts between sources (say which source states what).
6. Fix spelling and grammar. Keep English medical terms in English. No LaTeX, no --- lines, no HTML. Do not invent information.`,
    custom,
  )
