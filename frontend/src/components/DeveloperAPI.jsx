import React from 'react';
import { PageHeader, Card } from './ui';

const CodeBlock = ({ code }) => (
    <pre className="code-block">
        <code>{code}</code>
    </pre>
);

const InlineCode = ({ children }) => <code className="inline-code">{children}</code>;

const EndpointBadge = ({ method }) => (
    <span
        className="inline-block text-white text-xs font-bold px-2 py-0.5 rounded mr-2 font-mono"
        style={{ backgroundColor: 'var(--color-brand)' }}
    >
        {method}
    </span>
);

const SectionLink = ({ href, children }) => (
    <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand hover:text-brand-hover underline underline-offset-2"
    >
        {children}
    </a>
);

const SEARCH_REQUEST = `POST /agent/search

{
  "query": "आत्मा का स्वभाव क्या है?",
  "language": "hi",
  "content_type": ["Granth", "Books"],
  "anuyog": "Dravyanuyog",
  "page_size": 5,
  "page": 1,
  "rerank": true
}`;

const SEARCH_RESPONSE = `[
  {
    "chunk_id": "niyamsar_1975_p3_para2",
    "text_content": "आत्मा का स्वभाव ज्ञान और दर्शन है। जो ज्ञान और दर्शन से...",
    "category": "Granth",
    "granth": "Niyamsar",
    "author": "Kundkund Acharya",
    "anuyog": "Dravyanuyog",
    "language": "hi",
    "page_number": 3,
    "file_url": "https://...",
    "score": 0.94
  },
  ...
]`;

const FILTER_OPTIONS_REQUEST = `POST /agent/get_filter_options

{
  "language": "hi",
  "content_type": "Granth"
}`;

const FILTER_OPTIONS_RESPONSE = `{
  "granths": ["Niyamsar", "Samaysar", "Pravachansar", ...],
  "anuyogs": ["Dravyanuyog", "Charnanuyog", ...],
  "contributors": ["Kundkund Acharya", ...]
}`;

const RAG_PIPELINE = `# 1. Discover what's available
filters = POST /agent/get_filter_options
          { "language": "hi", "content_type": "Granth" }

# 2. Search — hybrid lexical + semantic
chunks = POST /agent/search
         { "query": user_query, "language": "hi",
           "content_type": ["Granth"],
           "anuyog": "Dravyanuyog",
           "page_size": 10, "rerank": True }

# 3. Expand context around top results
context = POST /agent/navigate
          { "chunk_id": chunks[0]["chunk_id"],
            "direction": "both", "steps": 2 }
# → [prev_2, prev_1, current, next_1, next_2]

# 4. Feed into LLM
passages = "\\n\\n".join(c["text_content"] for c in context)
prompt   = f"""You are a Jain philosophy assistant.
Answer using only the passages below.

{passages}

Question: {user_query}"""
answer = llm.complete(prompt)`;

const DeveloperAPI = () => {
    return (
        <div className="max-w-[1080px] mx-auto px-6 pb-6">

            <PageHeader
                variant="hero"
                title="Build with Swalakshya"
                subtitle="Access timeless Jain philosophy — ancient scriptures, Shri Kanji Swami's discourses, and contemporary scholarship — through simple APIs."
            />

            {/* Objective */}
            <h2 className="text-lg font-semibold text-ink tracking-tight mb-3">What you can build</h2>
            <p className="mb-5 text-sm text-ink leading-relaxed">
                The Swalakshya Agent API gives developers direct access to the indexed corpus,
                designed for building RAG-based pipelines, AI chatbots, semantic search engines,
                and research tools grounded in authentic Jain texts.
            </p>
            <div className="grid md:grid-cols-3 gap-3 mb-10">
                {[
                    { title: '🔗 RAG Pipelines', desc: 'Retrieve relevant passages and feed them into an LLM for grounded, citation-backed answers.' },
                    { title: '🤖 AI Chatbots', desc: 'Build conversational interfaces that answer questions directly from Jain scriptures and discourses.' },
                    { title: '🔍 Semantic Search', desc: 'Embed the search experience into your own app with full control over filters, language, and ranking.' },
                ].map(({ title, desc }) => (
                    <Card key={title} className="p-4">
                        <h3 className="font-semibold text-ink mb-1">{title}</h3>
                        <p className="text-sm text-ink-muted leading-relaxed">{desc}</p>
                    </Card>
                ))}
            </div>

            {/* The Corpus */}
            <h2 className="text-lg font-semibold text-ink tracking-tight mb-3">The Corpus</h2>
            <p className="mb-5 text-sm text-ink leading-relaxed">
                The index contains hundreds of thousands of paragraph-level chunks across three
                content types. Each chunk carries structured metadata — granth name, author,
                anuyog classification, page number, language — and a dense vector embedding
                for semantic search.
            </p>
            <div className="grid md:grid-cols-3 gap-3 mb-6">
                {[
                    {
                        title: '📜 Granth',
                        desc: 'Eternal, timeless wisdom from Jain Acharyas — Acharya Kundkund, Acharya Amrutchandra, Acharya Samantbhadra — and Jain Scholars — Pandit Todarmal, Pandit Banarasidas, and others. Comprised of all 4 Anuyogs: Dravyanuyog, Charananuyog, Karananuyog, and Prathmanuyog.'
                    },
                    {
                        title: '🎙️ Pravachan',
                        desc: 'Over 9,500 discourses by Pujya Shri Kanji Swami in Hindi and Gujarati, covering the full depth of Jain Tattva and Adhyatma, making the timeless wisdom of the scriptures accessible to spiritual seekers.'
                    },
                    {
                        title: '📚 Contemporary Literature',
                        desc: 'Contemporary literature by modern Jain Scholars bringing the same timeless wisdom into accessible, common-use language for modern readers.'
                    },
                ].map(({ title, desc }) => (
                    <Card key={title} className="p-4">
                        <h3 className="font-semibold text-ink mb-2">{title}</h3>
                        <p className="text-sm text-ink-muted leading-relaxed">{desc}</p>
                    </Card>
                ))}
            </div>
            <p className="mb-8 text-sm text-ink leading-relaxed">
                To see what is currently indexed, call the{' '}
                <SectionLink href="/api/metadata">/api/metadata</SectionLink>{' '}
                endpoint — it returns the live list of granths, anuyogs, contributors, and
                date ranges available for each content type and language.
            </p>

            {/* Base URL & Auth */}
            <h2 className="text-lg font-semibold text-ink tracking-tight mb-3">Base URL &amp; Auth</h2>
            <p className="mb-2 text-sm text-ink leading-relaxed">All agent endpoints are under:</p>
            <CodeBlock code="https://swalakshya.me/agent" />
            <p className="mb-8 text-sm text-ink leading-relaxed">
                No authentication required. All endpoints accept and return{' '}
                <InlineCode>application/json</InlineCode>.
                Set <InlineCode>Content-Type: application/json</InlineCode> on all POST requests.
            </p>

            {/* How to build */}
            <h2 className="text-lg font-semibold text-ink tracking-tight mb-3">How to build a RAG pipeline</h2>
            <p className="mb-2 text-sm text-ink leading-relaxed">
                The typical flow is: <strong>user query → your LLM → Agent API → grounded answer</strong>.
                Use <InlineCode>get_filter_options</InlineCode> to
                discover valid filters, <InlineCode>search</InlineCode> to
                retrieve relevant chunks, and <InlineCode>navigate</InlineCode> to
                expand context before feeding into the LLM.
            </p>
            <CodeBlock code={RAG_PIPELINE} />
            <p className="mb-8 text-sm text-ink leading-relaxed">
                The <InlineCode>navigate</InlineCode> step
                matters — individual chunks are paragraph-sized (~100–300 words). Expanding by 2 steps
                in each direction gives the LLM enough context to produce a coherent, grounded answer.
            </p>

            {/* API Examples */}
            <h2 className="text-lg font-semibold text-ink tracking-tight mb-3">API Examples</h2>

            <h3 className="text-sm font-semibold text-ink tracking-tight mb-1.5">Search</h3>
            <p className="text-sm text-ink-muted mb-1">Request</p>
            <CodeBlock code={SEARCH_REQUEST} />
            <p className="text-sm text-ink-muted mb-1">Response</p>
            <CodeBlock code={SEARCH_RESPONSE} />
            <p className="mb-6 text-sm text-ink leading-relaxed">
                The <InlineCode>rerank: true</InlineCode> flag
                applies a cross-encoder model (BAAI/bge-reranker-base) over the top-40 KNN candidates.
                Disable it for lower latency when precision is less critical.
            </p>

            <h3 className="text-sm font-semibold text-ink tracking-tight mb-1.5">Discover filter options</h3>
            <p className="text-sm text-ink-muted mb-1">Request</p>
            <CodeBlock code={FILTER_OPTIONS_REQUEST} />
            <p className="text-sm text-ink-muted mb-1">Response</p>
            <CodeBlock code={FILTER_OPTIONS_RESPONSE} />
            <p className="mb-8 text-sm text-ink leading-relaxed">
                Call this once at startup to populate dropdowns or validate user-provided filter values
                before passing them to <InlineCode>/agent/search</InlineCode>.
                The response reflects the live index — new content appears automatically.
            </p>

            {/* All Endpoints */}
            <h2 className="text-lg font-semibold text-ink tracking-tight mb-3">All Endpoints</h2>
            <div className="space-y-3 mb-10">
                {[
                    {
                        path: '/agent/search',
                        desc: 'Hybrid search over the full corpus. Supports content type, anuyog, granth, contributor, year range, and language filters. Returns ranked chunks with text, metadata, and relevance score.'
                    },
                    {
                        path: '/agent/navigate',
                        desc: <>Walk sequentially through a document from a given <InlineCode>chunk_id</InlineCode>. Retrieve up to 20 paragraphs before, after, or both — essential for expanding the LLM context window.</>
                    },
                    {
                        path: '/agent/find_similar',
                        desc: <>Given a <InlineCode>chunk_id</InlineCode>, returns the top 10 semantically related passages across the entire corpus. Useful for "more like this" features.</>
                    },
                    {
                        path: '/agent/get_filter_options',
                        desc: 'Returns valid granths, anuyogs, and contributors for a given language and content type. Reads live from the index.'
                    },
                    {
                        path: '/agent/get_pravachan',
                        desc: 'Fetches every paragraph of a specific numbered Pravachan in order. Use when you need the full text of a discourse rather than just top search results.'
                    },
                ].map(({ path, desc }) => (
                    <Card key={path} className="p-4">
                        <p className="font-mono text-sm mb-1.5">
                            <EndpointBadge method="POST" />{path}
                        </p>
                        <p className="text-sm text-ink-muted">{desc}</p>
                    </Card>
                ))}
            </div>

            {/* API Docs */}
            <Card className="p-6 mb-6">
                <h2 className="text-lg font-semibold text-ink mb-2">Full API Reference</h2>
                <p className="text-ink-muted text-sm mb-4">
                    Complete request/response schemas, field descriptions, validation rules, and
                    error codes — interactive and readable formats.
                </p>
                <div className="flex flex-wrap gap-2">
                    <a href="/agent/docs" target="_blank" rel="noopener noreferrer" className="btn btn-primary text-sm">
                        Swagger UI — try it live ↗
                    </a>
                    <a href="/agent/redoc" target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm">
                        ReDoc ↗
                    </a>
                    <a href="/agent/openapi.json" target="_blank" rel="noopener noreferrer" className="btn btn-secondary text-sm">
                        openapi.json ↗
                    </a>
                </div>
            </Card>

            {/* Sample App */}
            <Card className="notice-brand p-6 mb-8">
                <h2 className="text-lg font-semibold text-ink mb-2">Sample Application</h2>
                <p className="text-ink text-sm leading-relaxed mb-4">
                    <SectionLink href="https://github.com/swalakshya/cataloguesearch-chat">
                        cataloguesearch-chat
                    </SectionLink>{' '}
                    is a reference chatbot built entirely on this API — demonstrating query rewriting,
                    filter extraction, retrieval, context expansion, and grounded answer generation.
                    A practical starting point for building conversational interfaces over Jain texts.
                </p>
                <a
                    href="https://github.com/swalakshya/cataloguesearch-chat"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary text-sm inline-block"
                >
                    View on GitHub ↗
                </a>
            </Card>

            {/* Feedback */}
            <Card className="p-6 mb-8">
                <h2 className="text-lg font-semibold text-ink mb-2">Feedback</h2>
                <p className="text-ink-muted text-sm leading-relaxed mb-4">
                    Built something with this API, or have a suggestion for a new endpoint?
                    We'd love to hear from you.
                </p>
                <a href="/feedback" className="btn btn-secondary text-sm inline-block">
                    Send feedback
                </a>
            </Card>

        </div>
    );
};

export default DeveloperAPI;
