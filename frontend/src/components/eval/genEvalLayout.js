// Gen Eval's layout classes, normal vs fill (the panes fill the window). Normal keeps the widened card and 700px scroll boxes; full screen
// uses the normal width and lets the panes fill the screen height, with the PDF page fitted (no scrolling to see its bottom).
export const genEvalLayout = (fill) => ({
    card: `rounded-lg shadow-sm border border-slate-200${fill ? ' h-full flex flex-col' : ''}`,
    cardWidth: fill ? '100%' : '130%',
    title: fill ? 'hidden' : 'text-2xl font-bold text-slate-800 mb-2',
    row: `flex flex-col lg:flex-row${fill ? ' flex-1 min-h-0' : ''}`,
    leftCol: fill ? 'flex-1 min-w-0 min-h-0 p-2 border-r border-slate-200 flex flex-col' : 'flex-1 p-4 border-r border-slate-200',
    leftBox: `border border-slate-300 rounded-lg overflow-hidden mt-2${fill ? ' flex-1 min-h-0 flex flex-col' : ''}`,
    leftScroll: `p-4 ${fill ? 'flex-1 min-h-0' : 'max-h-[700px]'} overflow-y-auto flex justify-center${fill ? ' items-start' : ''}`,
    pdfImage: fill ? 'max-w-full max-h-full w-auto h-auto object-contain' : 'max-w-full h-auto',
    rightCol: fill ? 'flex-1 min-w-0 min-h-0 p-2 flex flex-col' : 'flex-1 p-4',
    rightBox: `border border-slate-300 rounded-lg overflow-hidden${fill ? ' flex-1 min-h-0 flex flex-col' : ''}`,
    rightScroll: `p-4 space-y-3 ${fill ? 'flex-1 min-h-0' : 'max-h-[700px]'} overflow-y-auto`,
});
