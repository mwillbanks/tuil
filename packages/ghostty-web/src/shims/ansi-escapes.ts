const controlSequenceIntroducer = "\u001b[";

export const cursorTo = (x: number, y?: number) =>
  y === undefined
    ? `${controlSequenceIntroducer}${x + 1}G`
    : `${controlSequenceIntroducer}${y + 1};${x + 1}H`;
export const cursorUp = (count = 1) => `${controlSequenceIntroducer}${count}A`;
export const cursorDown = (count = 1) =>
  `${controlSequenceIntroducer}${count}B`;
export const cursorNextLine = `${controlSequenceIntroducer}E`;
export const cursorLeft = `${controlSequenceIntroducer}G`;
export const eraseEndLine = `${controlSequenceIntroducer}K`;
export const eraseLine = `${controlSequenceIntroducer}2K`;
export const eraseScreen = `${controlSequenceIntroducer}2J`;
export const clearTerminal = `${eraseScreen}${controlSequenceIntroducer}3J${controlSequenceIntroducer}H`;
export const enterAlternativeScreen = `${controlSequenceIntroducer}?1049h`;
export const exitAlternativeScreen = `${controlSequenceIntroducer}?1049l`;

export const eraseLines = (count: number) => {
  let output = "";
  for (let index = 0; index < count; index += 1) {
    output += eraseLine;
    if (index < count - 1) output += cursorUp();
  }
  return count > 0 ? `${output}${cursorLeft}` : output;
};

const ansiEscapes = {
  clearTerminal,
  cursorDown,
  cursorNextLine,
  cursorTo,
  cursorUp,
  enterAlternativeScreen,
  eraseEndLine,
  eraseLines,
  exitAlternativeScreen,
};

export default ansiEscapes;
