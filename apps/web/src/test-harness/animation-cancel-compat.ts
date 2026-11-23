/**
 * Happy DOM 21.0.4 omits the handled-promise step of WAAPI cancellation.
 * https://drafts.csswg.org/web-animations-1/#cancel-an-animation (step 1.3)
 * Keep the rejected promise intact for consumers; do not suppress global errors.
 * This compatibility adapter is installed only by the unit-test environment.
 */
export function installAnimationCancelCompatibility(animationClass: typeof Animation): void {
  const cancel = animationClass.prototype.cancel;
  animationClass.prototype.cancel = function () {
    if (this.playState !== 'idle') {
      // Attaching a rejection handler marks this promise handled without changing
      // what awaiting the original `finished` promise observes.
      void this.finished.catch(() => undefined);
    }
    cancel.call(this);
  };
}
