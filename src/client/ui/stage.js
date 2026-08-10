const HIDDEN = '.toolbar, .note { display: none !important; }';

export function stripStageChrome(stage) {
  const style = document.createElement('style');
  style.textContent = HIDDEN;
  stage.shadowRoot.append(style);
  return stage;
}
