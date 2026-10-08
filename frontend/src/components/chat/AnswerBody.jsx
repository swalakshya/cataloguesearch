import React from 'react';
import StructuredAnswer from './StructuredAnswer';
import SummaryAnswer from './SummaryAnswer';

// The one swappable piece between the two chat experiences — everything
// else (session, composer, message list, follow-ups, share/feedback row,
// the PDF popup) is identical regardless of format and lives in ChatPage.
// format is now a live Settings choice (see chatConfig.js), not a build-time
// constant, so it's passed down as a prop from ChatPage rather than imported.
export default function AnswerBody({ format, ...props }) {
    if (format === 'summary') {
        return <SummaryAnswer {...props} />;
    }
    return <StructuredAnswer {...props} />;
}
