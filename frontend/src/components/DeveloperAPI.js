import React from 'react';

const CodeBlock = ({ code }) => (
    <pre className="bg-sky-50 text-sky-900 border border-sky-200 rounded p-4 overflow-x-auto text-sm font-mono leading-relaxed my-4">
        <code>{code}</code>
    </pre>
);

const EndpointBadge = ({ method }) => (
    <span className="inline-block bg-sky-700 text-white text-xs font-bold px-2 py-0.5 rounded mr-2 font-mono">
        {method}
    </span>
);

const SectionLink = ({ href, children }) => (
    <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-600 hover:text-sky-800 underline underline-offset-2"
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
        <div className="max-w-[1080px] mx-auto p-6">

            {/* Hero */}
            <div className="text-center pt-5 pb-6 mb-4">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight font-display mb-2">Build with Swalakshya</h1>
                <p className="text-sm text-slate-600 max-w-2xl mx-auto leading-relaxed">
                    Access timeless Jain philosophy — ancient scriptures, Shri Kanji Swami's
                    discourses, and contemporary scholarship — through simple APIs.
                </p>
            </div>

            {/* Objective */}
            <h2 className="text-lg font-semibold text-slate-800 tracking-tight mb-3">What you can build</h2>
            <p className="mb-5 text-sm text-slate-700 leading-relaxed">
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
                    <div key={title} className="border border-slate-200 rounded p-4">
                        <h3 className="font-semibold text-slate-800 mb-1">{title}</h3>
                        <p className="text-sm text-slate-600 leading-relaxed">{desc}</p>
                    </div>
                ))}
            </div>

            {/* The Corpus */}
            <h2 className="text-lg font-semibold text-slate-800 tracking-tight mb-3">The Corpus</h2>
            <p className="mb-5 text-sm text-slate-700 leading-relaxed">
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
                    <div key={title} className="border border-slate-200 rounded p-4">
                        <h3 className="font-semibold text-slate-800 mb-2">{title}</h3>
                        <p className="text-sm text-slate-600 leading-relaxed">{desc}</p>
                    </div>
                ))}
            </div>
            <p className="mb-8 text-sm text-slate-700 leading-relaxed">
                To see what is currently indexed, call the{' '}
                <SectionLink href="/api/metadata">/api/metadata</SectionLink>{' '}
                endpoint — it returns the live list of granths, anuyogs, contributors, and
                date ranges available for each content type and language.
            </p>

            {/* Base URL & Auth */}
            <h2 className="text-lg font-semibold text-slate-800 tracking-tight mb-3">Base URL &amp; Auth</h2>
            <p className="mb-2 text-sm text-slate-700 leading-relaxed">All agent endpoints are under:</p>
            <CodeBlock code="https://swalakshya.me/agent" />
            <p className="mb-8 text-sm text-slate-700 leading-relaxed">
                No authentication required. All endpoints accept and return{' '}
                <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">application/json</code>.
                Set <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">Content-Type: application/json</code> on all POST requests.
            </p>

            {/* How to build */}
            <h2 className="text-lg font-semibold text-slate-800 tracking-tight mb-3">How to build a RAG pipeline</h2>
            <p className="mb-2 text-sm text-slate-700 leading-relaxed">
                The typical flow is: <strong>user query → your LLM → Agent API → grounded answer</strong>.
                Use <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">get_filter_options</code> to
                discover valid filters, <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">search</code> to
                retrieve relevant chunks, and <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">navigate</code> to
                expand context before feeding into the LLM.
            </p>
            <CodeBlock code={RAG_PIPELINE} />
            <p className="mb-8 text-sm text-slate-700 leading-relaxed">
                The <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">navigate</code> step
                matters — individual chunks are paragraph-sized (~100–300 words). Expanding by 2 steps
                in each direction gives the LLM enough context to produce a coherent, grounded answer.
            </p>

            {/* API Examples */}
            <h2 className="text-lg font-semibold text-slate-800 tracking-tight mb-3">API Examples</h2>

            <h3 className="text-sm font-semibold text-slate-700 tracking-tight mb-1.5">Search</h3>
            <p className="text-sm text-slate-500 mb-1">Request</p>
            <CodeBlock code={SEARCH_REQUEST} />
            <p className="text-sm text-slate-500 mb-1">Response</p>
            <CodeBlock code={SEARCH_RESPONSE} />
            <p className="mb-6 text-sm text-slate-700 leading-relaxed">
                The <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">rerank: true</code> flag
                applies a cross-encoder model (BAAI/bge-reranker-base) over the top-40 KNN candidates.
                Disable it for lower latency when precision is less critical.
            </p>

            <h3 className="text-sm font-semibold text-slate-700 tracking-tight mb-1.5">Discover filter options</h3>
            <p className="text-sm text-slate-500 mb-1">Request</p>
            <CodeBlock code={FILTER_OPTIONS_REQUEST} />
            <p className="text-sm text-slate-500 mb-1">Response</p>
            <CodeBlock code={FILTER_OPTIONS_RESPONSE} />
            <p className="mb-8 text-sm text-slate-700 leading-relaxed">
                Call this once at startup to populate dropdowns or validate user-provided filter values
                before passing them to <code className="bg-slate-100 px-1 py-0.5 rounded text-sm font-mono">/agent/search</code>.
                The response reflects the live index — new content appears automatically.
            </p>

            {/* All Endpoints */}
            <h2 className="text-lg font-semibold text-slate-800 tracking-tight mb-3">All Endpoints</h2>
            <div className="space-y-3 mb-10">
                {[
                    {
                        path: '/agent/search',
                        desc: 'Hybrid search over the full corpus. Supports content type, anuyog, granth, contributor, year range, and language filters. Returns ranked chunks with text, metadata, and relevance score.'
                    },
                    {
                        path: '/agent/navigate',
                        desc: <>Walk sequentially through a document from a given <code className="bg-slate-100 px-1 rounded font-mono text-xs">chunk_id</code>. Retrieve up to 20 paragraphs before, after, or both — essential for expanding the LLM context window.</>
                    },
                    {
                        path: '/agent/find_similar',
                        desc: <>Given a <code className="bg-slate-100 px-1 rounded font-mono text-xs">chunk_id</code>, returns the top 10 semantically related passages across the entire corpus. Useful for "more like this" features.</>
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
                    <div key={path} className="border border-slate-200 rounded p-4">
                        <p className="font-mono text-sm mb-1.5">
                            <EndpointBadge method="POST" />{path}
                        </p>
                        <p className="text-sm text-slate-600">{desc}</p>
                    </div>
                ))}
            </div>

            {/* API Docs */}
            <div className="bg-slate-50 border border-slate-200 rounded p-6 mb-6">
                <h2 className="text-lg font-semibold text-slate-800 mb-2">Full API Reference</h2>
                <p className="text-slate-600 text-sm mb-4">
                    Complete request/response schemas, field descriptions, validation rules, and
                    error codes — interactive and readable formats.
                </p>
                <div className="flex flex-wrap gap-2">
                    <a href="/agent/docs" target="_blank" rel="noopener noreferrer"
                        className="bg-sky-600 text-white font-semibold px-4 py-1.5 rounded text-sm hover:bg-sky-700 transition duration-200">
                        Swagger UI — try it live ↗
                    </a>
                    <a href="/agent/redoc" target="_blank" rel="noopener noreferrer"
                        className="bg-slate-200 text-slate-700 font-semibold px-4 py-1.5 rounded text-sm hover:bg-slate-300 transition duration-200">
                        ReDoc ↗
                    </a>
                    <a href="/agent/openapi.json" target="_blank" rel="noopener noreferrer"
                        className="bg-white text-slate-700 font-semibold px-4 py-1.5 rounded text-sm border border-slate-300 hover:bg-slate-50 transition duration-200">
                        openapi.json ↗
                    </a>
                </div>
            </div>

            {/* Sample App */}
            <div className="bg-gradient-to-r from-sky-50 to-blue-50 rounded p-6 border border-sky-100 mb-8">
                <h2 className="text-lg font-semibold text-slate-800 mb-2">Sample Application</h2>
                <p className="text-slate-700 text-sm leading-relaxed mb-4">
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
                    className="bg-slate-800 text-white font-semibold px-4 py-1.5 rounded text-sm hover:bg-slate-900 transition duration-200 inline-block"
                >
                    View on GitHub ↗
                </a>
            </div>

            {/* Feedback */}
            <div className="border border-slate-200 rounded p-6 mb-8">
                <h2 className="text-lg font-semibold text-slate-800 mb-2">Feedback</h2>
                <p className="text-slate-600 text-sm leading-relaxed mb-4">
                    Built something with this API, or have a suggestion for a new endpoint?
                    We'd love to hear from you.
                </p>
                <a
                    href="/feedback"
                    className="bg-slate-200 text-slate-700 font-semibold px-4 py-1.5 rounded text-sm hover:bg-slate-300 transition duration-200 inline-block"
                >
                    Send feedback
                </a>
            </div>

        </div>
    );
};

export default DeveloperAPI;
