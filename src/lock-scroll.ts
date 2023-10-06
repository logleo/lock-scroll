/**
 * 处理浮层的滚动穿透
 *
 * 思路：
 * 1、初始化通过选择器确定可滚动的元素（浮层类元素）
 * 2、组件主动调用实例的 lock 事件，事件内部需要：
 * （1）监听浮层元素的 touchstart 事件，发生时要为 document 绑定一个 touchmove 事件，事件中仅允许浮层元素滚动，而不允许 document 发生滚动。
 * （2）监听浮层元素的 touchend 事件，发生时要为 document 解绑在 touchstart 阶段绑定的 touchmove 事件。
 * （3）滚动浮层元素时可能会超出边界，也会造成穿透？
 * 3、组件主动调用实例的 unlock 事件，事件内部需要：
 * （1）解除监听浮层元素的 touchstart 事件
 * （2）解除监听浮层元素的 touchend 事件
 */

/** 实例化参数 */
export interface LockScrollParams {
  selector?: string;
}

interface ITouch {
  originX: number;
  originY: number;
}

/** 是否初始化 document touchmove 事件 */
let eventInit = false;

/** 当前平台是否具有 passive event */
let hasPassiveEvents = false;

/** 实例集合（通过选择器匹配）*/
const lockedList = new Set<LockScroll>();

/** range 事件 Map，用于销毁阶段 */
const overRangeEventMap = new Map<
  HTMLElement,
  {
    touchStartEvent?: (e: TouchEvent) => void;
    touchMoveEvent?: (e: TouchEvent) => void;
  }
>();

// 检查 passive event（安卓环境需要禁用 passive，避免绑定事件时延迟的 200ms）
if (typeof window !== 'undefined') {
  const passiveTestOptions = {
    get passive() {
      hasPassiveEvents = true;
      return undefined;
    },
  };
  try {
    const emptyListener = () => {
      // do nothing
    };
    window.addEventListener('testPassive', emptyListener, passiveTestOptions);
    window.removeEventListener(
      'testPassive',
      emptyListener,
      passiveTestOptions as EventListenerOptions
    );
  } catch (e) {
    // do nothing
  }
}

function isDocumentExist() {
  return typeof window !== 'undefined' && window.document;
}

export class LockScroll {
  /** 当前实例的容器选择器 */
  public selector: string;

  constructor(opt: LockScrollParams = { selector: '.can-scroll' }) {
    if (opt.selector) {
      this.selector = opt.selector;
    }
  }

  public getPassiveOptions() {
    return hasPassiveEvents
      ? ({
          passive: false,
        } as EventListenerOptions)
      : undefined;
  }

  private observeDocumentTouchMoveEvent(
    type: 'addEventListener' | 'removeEventListener'
  ) {
    window[type](
      'touchmove',
      LockScroll.preventDefault as EventListener,
      this.getPassiveOptions()
    );
  }

  public lock() {
    // 当前实例添加到集合
    lockedList.add(this);
    if (!isDocumentExist()) {
      return;
    }
    this.bindTouchEvents();
    this.lockScrollWhenOverRange();
  }

  public unlock() {
    lockedList.delete(this);
    if (!isDocumentExist()) {
      return;
    }
    this.unbindTouchEvents();
    this.unlockScrollWhenOverRange();
  }

  private elTouchStart() {
    if (!eventInit) {
      this.observeDocumentTouchMoveEvent('addEventListener');
      eventInit = true;
    }
  }

  private elTouchEnd() {
    if (eventInit) {
      this.observeDocumentTouchMoveEvent('removeEventListener');
      eventInit = false;
    }
  }

  /** 为浮层元素绑定 touchstart、touchend 事件 */
  private bindTouchEvents() {
    const enableScrollEls = this.getCurScrollEls();
    const touchStart = this.elTouchStart.bind(this);
    const touchEnd = this.elTouchEnd.bind(this);
    enableScrollEls.forEach((el: HTMLElement) => {
      el.addEventListener('touchstart', touchStart);
      el.addEventListener('touchend', touchEnd);
    });
  }

  /** 为浮层元素解绑 touchstart、touchend 事件 */
  private unbindTouchEvents() {
    const enableScrollEls = this.getCurScrollEls();
    const touchStart = this.elTouchStart.bind(this);
    const touchEnd = this.elTouchEnd.bind(this);
    enableScrollEls.forEach((el: HTMLElement) => {
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('touchend', touchEnd);
    });
    // 兜底情况，有时元素隐藏比较快，没来得及触发 touchend，导致 document 上的 touchmove 事件没被卸载
    touchEnd();
  }

  /** 对于可滚动元素，当它们超过滚动边界时，依然会触发穿透，需要阻止 */
  private lockScrollWhenOverRange() {
    const scrollEls = this.getCurScrollEls();
    scrollEls.forEach((el: HTMLElement) => {
      const touch: ITouch = {} as ITouch;
      const touchStartEvent = (e: TouchEvent) => {
        // 单指行为
        if (e.targetTouches.length === 1) {
          const originTouch = e.targetTouches[0];
          touch.originX = originTouch.clientX;
          touch.originY = originTouch.clientY;
        }
      };
      el.addEventListener('touchstart', touchStartEvent);

      const touchMoveEvent = (e: TouchEvent) => {
        // 单指行为
        if (e.targetTouches.length === 1) {
          const currentTouch = e.targetTouches[0];
          const offsetX = currentTouch.clientX - touch.originX; // offsetX 表示离视口左侧距离，差值为负数表示往右滚动
          const offsetY = currentTouch.clientY - touch.originY; // offsetY 表示离视口顶部距离，差值为负数表示往下滚动
          const absOffsetX = Math.abs(offsetX);
          const absOffsetY = Math.abs(offsetY);
          // 当移动距离较短时，视为无效滚动，先阻止默认行为。
          const invalidScroll = absOffsetX < 3 && absOffsetY < 3;
          if (invalidScroll) {
            return e.preventDefault();
          }
          // 纵向滚动 - 滚动超出上/下边界
          if (absOffsetY > absOffsetX) {
            if (
              (el.scrollTop <= 0 && offsetY > 0) ||
              (el.scrollTop + el.clientHeight >= el.scrollHeight && offsetY < 0)
            ) {
              return e.preventDefault();
            }
            return;
          }
          // 横向滚动 - 滚动超出左/右边界
          if (
            (el.scrollLeft <= 0 && offsetX > 0) ||
            (el.scrollLeft + el.clientWidth >= el.scrollWidth && offsetX < 0)
          ) {
            return e.preventDefault();
          }
        }
      };
      el.addEventListener(
        'touchmove',
        touchMoveEvent,
        this.getPassiveOptions()
      );

      // 由于此处的 listener 闭包了一个变量，用 map 暂存便于后续阶段释放内存
      overRangeEventMap.set(el, {
        touchStartEvent,
        touchMoveEvent,
      });
    });
  }

  /** 解锁超出边界的事件处理 */
  private unlockScrollWhenOverRange() {
    const scrollEls = this.getCurScrollEls();
    scrollEls.forEach((el: HTMLElement) => {
      const eventMap = overRangeEventMap.get(el);
      eventMap?.touchStartEvent &&
        el.removeEventListener('touchstart', eventMap.touchStartEvent);
      eventMap?.touchMoveEvent &&
        el.removeEventListener(
          'touchmove',
          eventMap.touchMoveEvent,
          this.getPassiveOptions()
        );
      overRangeEventMap.delete(el);
    });
  }

  /** 阻止 document 上其他元素发生滚动 */
  private static preventDefault(e: TouchEvent) {
    const target = e.target as HTMLElement;
    const scrollEls = LockScroll.getScrollEls();
    // 可滚动元素的后代，支持滚动
    const isContain = [].some.call(scrollEls, (el: HTMLElement) =>
      el.contains(target)
    );
    if (isContain) {
      return;
    }
    // 不包含需要阻止默认行为
    e.preventDefault();
  }

  /** 获取当前实例中允许滚动的元素 */
  private getCurScrollEls(): HTMLElement[] {
    return this.selector
      ? Array.from(document.querySelectorAll(this.selector))
      : [];
  }

  /** 获取当前所有实例中允许滚动的元素 */
  private static getScrollEls() {
    const selectors: string[] = [];
    for (const item of lockedList) {
      const curSelector = item.selector;
      if (selectors.find((s) => s === curSelector)) {
        continue;
      }
      selectors.push(curSelector);
    }
    const selectorStr = selectors.join(',');
    // querySelector 不支持传入空字符串，要格外注意
    return selectorStr ? document.querySelectorAll(selectorStr) : [];
  }
}
