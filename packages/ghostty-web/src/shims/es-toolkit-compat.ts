type AnyFunction = (...arguments_: never[]) => unknown;

export interface ThrottledFunction<FunctionType extends AnyFunction> {
  (
    ...arguments_: Parameters<FunctionType>
  ): ReturnType<FunctionType> | undefined;
  cancel(): void;
  flush(): ReturnType<FunctionType> | undefined;
}

export function throttle<FunctionType extends AnyFunction>(
  callback: FunctionType,
  wait = 0,
  options: {
    readonly leading?: boolean;
    readonly trailing?: boolean;
  } = {},
): ThrottledFunction<FunctionType> {
  const leading = options.leading ?? true;
  const trailing = options.trailing ?? true;
  let lastInvocation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingArguments: Parameters<FunctionType> | undefined;
  let pendingThis: unknown;
  let result: ReturnType<FunctionType> | undefined;

  const invoke = (timestamp: number) => {
    lastInvocation = timestamp;
    const arguments_ = pendingArguments;
    const thisValue = pendingThis;
    pendingArguments = undefined;
    pendingThis = undefined;
    if (arguments_) {
      result = callback.apply(
        thisValue,
        arguments_,
      ) as ReturnType<FunctionType>;
    }
    return result;
  };

  const onTimeout = () => {
    timer = undefined;
    if (trailing && pendingArguments) invoke(Date.now());
  };

  const throttled = function (
    this: unknown,
    ...arguments_: Parameters<FunctionType>
  ) {
    const timestamp = Date.now();
    if (lastInvocation === 0 && !leading) lastInvocation = timestamp;
    const remaining = Math.max(0, wait - (timestamp - lastInvocation));
    pendingArguments = arguments_;
    pendingThis = this;

    if (remaining === 0 || remaining > wait) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      return invoke(timestamp);
    }

    if (!timer && trailing) timer = setTimeout(onTimeout, remaining);
    return result;
  } as ThrottledFunction<FunctionType>;

  throttled.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pendingArguments = undefined;
    pendingThis = undefined;
    lastInvocation = 0;
  };
  throttled.flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    return pendingArguments ? invoke(Date.now()) : result;
  };

  return throttled;
}
