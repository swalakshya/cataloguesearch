// Gen Eval's layout classes, normal vs fill (the panes fill the window). Normal keeps the widened card and 700px scroll boxes; full screen
// uses the normal width and lets the panes fill the screen height, with the PDF page fitted (no scrolling to see its bottom).
export const genEvalLayout = (fill) => ({
    card: `rounded-lg shadow-sm border border-slate-200${fill ? ' h-full flex flex-col' : ''}`,
    cardWidth: fill ? '100%' : '130%',
    title: fill ? 'hidden' : 'text-2xl font-bold text-slate-800 mb-2',
    row: `flex flex-col lg:flex-row${fill ? ' flex-1 min-h-0' : ''}`,
    // A PDF page is portrait and never needs half the row -- giving it flex-[2] against the text's flex-[3] (was an
    // even 1:1 split) removes the empty gutter that used to sit either side of the page image, and hands that room
    // to the paragraph text instead, which reads more easily with the extra width.
    leftCol: fill ? 'flex-[2] min-w-0 min-h-0 p-2 border-r border-slate-200 flex flex-col' : 'flex-[2] p-4 border-r border-slate-200',
    // No top margin here (matches rightBox): the header row above already ends in mb-3, so an extra mt-2 on top of
    // that pushed the PDF page box lower than the paragraphs box, misaligning the two columns. The JSON-view save
    // banner/buttons that can appear between the header and this box already carry their own mt-2.
    leftBox: `border border-slate-300 rounded-lg overflow-hidden${fill ? ' flex-1 min-h-0 flex flex-col' : ''}`,
    leftScroll: `p-4 ${fill ? 'flex-1 min-h-0' : 'max-h-[700px]'} overflow-y-auto flex justify-center${fill ? ' items-start' : ''}`,
    pdfImage: fill ? 'max-w-full max-h-full w-auto h-auto object-contain' : 'max-w-full h-auto',
    rightCol: fill ? 'flex-[3] min-w-0 min-h-0 p-2 flex flex-col' : 'flex-[3] p-4',
    rightBox: `border border-slate-300 rounded-lg overflow-hidden${fill ? ' flex-1 min-h-0 flex flex-col' : ''}`,
    rightScroll: `p-4 space-y-3 ${fill ? 'flex-1 min-h-0' : 'max-h-[700px]'} overflow-y-auto`,
});
