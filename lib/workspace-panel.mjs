export const COMPACT_WORKSPACE_HEIGHT_CLASS = "xl:h-[760px]";
export const RESULT_WORKSPACE_CLASS = `min-w-0 xl:flex ${COMPACT_WORKSPACE_HEIGHT_CLASS} xl:flex-col`;
export const RESULT_LIST_CLASS = "space-y-3 pr-1 scrollbar-thin xl:min-h-0 xl:flex-1 xl:overflow-y-auto";

export function inputPanelView(expanded) {
  const isExpanded = expanded === true;
  return Object.freeze({
    expanded: isExpanded,
    toggleLabel: isExpanded ? "입력창 접기" : "입력창 펼치기",
    panelClass: isExpanded ? "xl:min-h-[760px]" : COMPACT_WORKSPACE_HEIGHT_CLASS,
    textareaWrapperClass: isExpanded ? "" : "xl:min-h-0 xl:flex-1",
    textareaClass: isExpanded
      ? "min-h-[70vh] resize-y xl:min-h-[900px]"
      : "min-h-[390px] resize-none xl:h-full xl:min-h-0",
  });
}
