# Coze PPT 在线编辑器代码实现细节

## 一、图表编辑代理模式实现

### 1.1 Chart.js 代理实现

```javascript
// 保存原始 Chart 类
window.originalChart = window.Chart;

// 创建数据存储
const UPDATED_DATA_MAP = {};

// 代理 Chart 类
window.Chart = class Chart extends window.originalChart {
  constructor(context, options = {}) {
    // 获取 canvas 元素
    var canvas = getCanvas(context);
    
    // 标记为图表容器
    canvas.dataset.he_chart_container = true;
    canvas.dataset.he_chart_container_chartjs = true;
    
    var id = canvas.id;
    
    // 初始化时存储原始配置
    if (!UPDATED_DATA_MAP[id]) {
      UPDATED_DATA_MAP[id] = options;
    }

    // 使用存储的配置（可能已被编辑）
    var newOptions = UPDATED_DATA_MAP[id];
    
    // 调用原始构造函数
    var instance = super(context, newOptions);
    instance.update();
    
    return instance;
  }
};

// 工具函数：获取 canvas 元素
function getCanvas(context) {
  if (context instanceof HTMLCanvasElement) {
    return context;
  }
  if (context && context.canvas) {
    return context.canvas;
  }
  if (typeof context === 'string') {
    return document.getElementById(context);
  }
  return null;
}

// 自定义背景色插件
const bgPlugin = {
  id: 'customCanvasBackgroundColor',
  beforeDraw: (chart, args, options) => {
    if (!options.color) return;
    
    const { ctx } = chart;
    ctx.save();
    // destination-over：在现有内容后面绘制
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = options.color;
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
};

window.Chart.register(bgPlugin);

// 注册 ChartDataLabels 插件（用于显示数据标签）
if (window.ChartDataLabels) {
  window.Chart.register(ChartDataLabels);
  // 默认隐藏数据标签
  Chart.defaults.plugins.datalabels.opacity = 0;
}
```

### 1.2 ECharts 代理实现

```javascript
// 保存原始 init 方法
var originalInit = echarts.init;

// 代理 init 方法
echarts.init = function patchedInit(dom, theme, initOpts) {
  try {
    // 标记 DOM 元素
    dom.dataset.he_chart_container = 'true';
    dom.dataset.he_chart_container_echarts = 'true';

    // 调用原始 init
    var inst = originalInit.call(echarts, dom, theme, initOpts);
    
    // 保存原始 setOption 方法
    var rawSetOption = inst.setOption.bind(inst);

    // 代理 setOption 方法
    inst.setOption = function patchedSetOption(option, setOpts) {
      // 检查是否为编辑操作
      const isEdit = setOpts && setOpts.he_forceOption;
    
      if (isEdit) {
        // 保存编辑后的配置
        UPDATED_DATA_MAP[this._dom.id] = option;
      }
      
      // 使用存储的配置或当前配置
      var next = UPDATED_DATA_MAP[this._dom.id];
      return rawSetOption(next || option, setOpts);
    };
   
    return inst;
  } catch (error) {
    console.error('proxyEchartsTemplate catch', error);
  }
};
```

## 二、元素选中与编辑实现

### 2.1 元素类型识别

```javascript
// 元素类型枚举
const EditableType = {
  Text: 'text',      // 文本元素
  Image: 'image',    // 图片元素
  Block: 'block',    // 区块元素
  Chart: 'chart'     // 图表元素（Chart.js/ECharts）
};

const TYPE_NAMES = {
  text: '文本',
  image: '图片',
  block: '区块',
  chart: '图表',
};

// 判断是否为图表元素
function isChartElement(element) {
  // 检查 nodeInfo 标记
  if (element.nodeInfo?.editType === 'chart') return true;
  
  // 检查 dataset 标记（代理模式添加的）
  return element.dataset?.he_chart_container === 'true';
}

// 判断是否为图片元素
function isImageElement(element) {
  if (element.nodeInfo?.editType === 'image') return true;
  
  // 检查是否为 img 标签或包含图片背景
  return element.tagName === 'IMG' || 
         hasImageBackground(element);
}

// 判断是否为文本元素
function isTextElement(element) {
  if (element.nodeInfo?.editType === 'text') return true;
  
  // 检查是否包含文本节点
  return Array.from(element.childNodes).some(node => {
    return node.nodeType === Node.TEXT_NODE && 
           node.textContent.trim() !== '';
  });
}

// 判断是否为区块元素
function isBlockElement(element) {
  if (element.nodeInfo?.editType === 'block') return true;
  
  // 既不是图表、图片、文本，但是可见元素
  return hasVisibleContent(element);
}

// 获取元素的编辑类型
function getEditableType(element) {
  if (!element) return null;
  
  // 优先检查 nodeInfo 标记
  if (element.nodeInfo?.editType) {
    return element.nodeInfo.editType;
  }
  
  // 通过特征判断
  if (isImageElement(element)) return 'image';
  if (isTextElement(element)) return 'text';
  if (isChartElement(element)) return 'chart';
  if (isBlockElement(element)) return 'block';
  
  return null;
}
```

### 2.2 元素选中机制

```javascript
// 监听 iframe 内的点击事件
function setupElementSelection(iframeWindow, iframeDoc, options) {
  const { 
    editableTypes = [],        // 允许编辑的元素类型
    onSelect,                  // 选中回调
    customFilter,              // 自定义过滤器
  } = options;
  
  const handleClick = (event) => {
    const target = event.target;
    
    // 过滤掉不可编辑的元素
    if (isNonEditableElement(target)) return;
    
    // 过滤掉选中框本身
    if (target.closest('.select-box') || target.closest('.helper-box')) {
      return;
    }
    
    // 自定义过滤
    if (customFilter && !customFilter(target)) return;
    
    // 向上查找最近的可编辑元素
    let editableElement = null;
    let currentElement = target;
    
    while (currentElement) {
      const editType = getEditableType(currentElement);
      
      // 如果指定了类型限制，只选择匹配的类型
      if (editType !== null && 
          (!editableTypes.length || editableTypes.includes(editType))) {
        editableElement = currentElement;
        break;
      }
      
      currentElement = currentElement.parentElement;
    }
    
    // 更新选中状态
    if (editableElement) {
      setSelectedElement(editableElement);
    } else {
      setSelectedElement(null);
    }
  };
  
  // 监听父页面点击，取消选中
  const handleOutsideClick = (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    
    const { target } = event;
    const isHelper = target.closest('.helper-box');
    
    // 点击在 iframe 外部且不是辅助元素
    if (!iframeDoc.contains(target) && !isHelper) {
      setSelectedElement(null);
    }
  };
  
  // 注册事件监听
  iframeDoc.addEventListener('mousedown', handleClick);
  document.body.addEventListener('mousedown', handleOutsideClick);
  
  return () => {
    iframeDoc.removeEventListener('mousedown', handleClick);
    document.body.removeEventListener('mousedown', handleOutsideClick);
  };
}

// 获取 iframe 的缩放比例
function getIframeScale(iframe) {
  const transform = iframe.style.transform;
  const match = transform.match(/scale\(([\d.]+)\)/);
  return match ? parseFloat(match[1]) : 1;
}

// 防止双击时打开文本编辑器
function preventDoubleClickConflict(iframeDoc) {
  const handleDoubleClick = (event) => {
    event.stopPropagation();
    event.preventDefault();
    
    // 发送消息通知主应用
    window.postMessage({
      type: 'open-text-editor',
      key: SECURITY_KEY,
    }, '*');
  };
  
  // 监听其他窗口的文本编辑器打开事件
  const handleMessage = (event) => {
    if (event.data.type === 'open-text-editor' && 
        event.data.key !== SECURITY_KEY) {
      // 关闭当前编辑器
      setSelectedElement(null);
    }
  };
  
  window.addEventListener('message', handleMessage);
  iframeDoc.addEventListener('click', handleDoubleClick, { capture: true });
  
  return () => {
    window.removeEventListener('message', handleMessage);
    iframeDoc.removeEventListener('click', handleDoubleClick, { capture: true });
  };
}
```

### 2.3 选中框渲染

选中框使用 **React Portal** 渲染到 **iframe.body** 中，而不是渲染在主应用中。这样做的好处：
- **无需坐标转换**：选中框与元素在同一坐标系中
- **精准对齐**：避免缩放比例导致的误差
- **事件处理简单**：直接使用 iframe 内的事件

```javascript
// 主组件：使用 createPortal 将选中框渲染到 iframe 内
function EditableIframeContainer({ iframeWindow, iframeDoc }) {
  const { selectedElement, selectedElementRect } = useStore(state => ({
    selectedElement: state.selectedElement,
    selectedElementRect: state.getSelectedElementRect(),
  }));
  
  const editType = getEditableType(selectedElement);
  
  if (!selectedElementRect || !iframeDoc || !selectedElement || !editType) {
    return null;
  }
  
  // 辅助线 Portal （对齐辅助线）
  const snapLinePortal = createPortal(
    <SnapLines snap={snap} targetEl={selectedElement} />,
    iframeDoc.body  // 渲染到 iframe 的 body
  );
  
  // 选中框 Portal
  const selectionBoxPortal = createPortal(
    <SelectionBox 
      selectedElement={selectedElement}
      selectedRect={selectedElementRect}
      editType={editType}
      isDragging={isDragging}
    />,
    iframeDoc.body  // 渨染到 iframe 的 body
  );
  
  return (
    <>
      {snapLinePortal}
      {selectionBoxPortal}
    </>
  );
}

// 选中框组件
function SelectionBox({ selectedElement, selectedRect, editType, isDragging }) {
  const PADDING = 4;  // 选中框内边距
  
  // 计算选中框样式
  const boxStyle = {
    position: 'absolute',
    left: selectedRect.left - (editType === 'image' ? 0 : PADDING),
    top: selectedRect.top,
    width: selectedRect.width + (editType === 'image' ? 0 : PADDING * 2),
    height: selectedRect.height,
    boxSizing: 'border-box',
    zIndex: 1000,
    pointerEvents: 'none',  // 选中框本身不响应鼠标事件
  };
  
  // 如果不可拖拽，只显示边框
  const borderStyle = editType !== 'inline' ? {
    border: '2px solid #596CFF',
    borderRadius: '2px',
  } : {};
  
  return (
    <div style={{...boxStyle, ...borderStyle}}>
      {/* 可拖拽元素显示拖拽手柄 */}
      {editType !== 'inline' && !isDragging && (
        <>
          <DragHandle onDragStart={handleDrag} />
          <ResizeHandles onResize={handleResize} />
          <RotateHandle onRotate={handleRotate} />
        </>
      )}
    </div>
  );
}
```

## 三、拖拽与缩放实现

### 3.1 拖拽实现

```javascript
function useDrag({ element, onMove, scale }) {
  // 拖拽状态跟踪
  const dragStateRef = useRef({
    isMouseDown: false,    // 鼠标是否按下
    startTime: 0,          // 按下时间（用于区分点击和拖拽）
    startX: 0,             // 起始 X 坐标
    startY: 0,             // 起始 Y 坐标
    hasMoved: false,       // 是否已移动
    dragStarted: false,    // 是否已开始拖拽
  });
  
  const handleMouseDown = (event) => {
    if (!selectedElement || !boxRef.current) return;
    
    // 禁止文本选择
    selectedElement.style.userSelect = 'none';
    
    const rect = boxRef.current.getBoundingClientRect();
    const clientX = event.clientX;
    const clientY = event.clientY;
    
    // 检查点击是否在选中框内
    if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
      dragStateRef.current = {
        isMouseDown: true,
        startTime: Date.now(),
        startX: clientX,
        startY: clientY,
        hasMoved: false,
        dragStarted: false,
      };
    }
  };
  
  const handleMouseMove = (event) => {
    if (!dragStateRef.current.isMouseDown) return;
    
    // 计算移动距离（使用勾股定理）
    const distance = Math.sqrt(
      Math.pow(event.clientX - dragStateRef.current.startX, 2) + 
      Math.pow(event.clientY - dragStateRef.current.startY, 2)
    );
    
    // 移动超过 3px 才算拖拽
    if (distance > 3) {
      dragStateRef.current.hasMoved = true;
      
      // 超过 100ms 才开始真正的拖拽
      if (Date.now() - dragStateRef.current.startTime > 100 &&
          !dragStateRef.current.dragStarted) {
        dragStateRef.current.dragStarted = true;
        
        // 触发拖拽开始回调
        onDragStart({
          clientX: dragStateRef.current.startX,
          clientY: dragStateRef.current.startY,
        });
      }
    }
  };
  
  const handleMouseUp = (event) => {
    if (!dragStateRef.current.isMouseDown) return;
    
    // 恢复文本选择
    if (selectedElement) {
      selectedElement.style.removeProperty('user-select');
    }
    
    const elapsedTime = Date.now() - dragStateRef.current.startTime;
    const isClick = !dragStateRef.current.hasMoved;
    
    // 快速点击（< 200ms）且未移动 = 选择子元素
    if (elapsedTime < 200 && isClick) {
      const target = event.target;
      if (selectedElement && selectedElement.contains(target) && target !== selectedElement) {
        // 查找最近的可编辑父元素
        let parent = target;
        while (parent && parent !== selectedElement) {
          if (getEditableType(parent) !== null) {
            setSelectedElement(parent);
            break;
          }
          parent = parent.parentElement;
        }
      }
    }
    
    // 重置状态
    dragStateRef.current = {
      isMouseDown: false,
      startTime: 0,
      startX: 0,
      startY: 0,
      hasMoved: false,
      dragStarted: false,
    };
  };
  
  // 注册事件监听
  useEffect(() => {
    if (!iframeDoc) return;
    
    // 阻止默认拖拽行为
    const preventDefaultDrag = (e) => {
      if (!selectedElement) return;
      const target = e.target;
      if (selectedElement === target || selectedElement.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    iframeDoc.addEventListener('mousedown', handleMouseDown);
    iframeDoc.addEventListener('mousemove', handleMouseMove);
    iframeDoc.addEventListener('mouseup', handleMouseUp);
    iframeDoc.addEventListener('dragstart', preventDefaultDrag);
    
    return () => {
      iframeDoc.removeEventListener('mousedown', handleMouseDown);
      iframeDoc.removeEventListener('mousemove', handleMouseMove);
      iframeDoc.removeEventListener('mouseup', handleMouseUp);
      iframeDoc.removeEventListener('dragstart', preventDefaultDrag);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, iframeDoc, selectedElement]);
  
  return { handleMouseDown };
}
```

### 3.2 缩放手柄实现

```javascript
// 选中框完整结构
function SelectionBox({ selectedElement, selectedRect, editType, isDragging }) {
  const PADDING = 4;  // 选中框内边距
  
  // 计算选中框样式
  const boxStyle = {
    position: 'absolute',
    left: selectedRect.left - (editType === 'image' ? 0 : PADDING),
    top: selectedRect.top,
    width: selectedRect.width + (editType === 'image' ? 0 : PADDING * 2),
    height: selectedRect.height,
    boxSizing: 'border-box',
    zIndex: 1000,
    pointerEvents: 'none',
  };
  
  // 非行内元素显示边框
  const borderStyle = editType !== 'inline' ? {
    border: '2px solid #596CFF',
    borderRadius: '2px',
  } : {};
  
  return (
    <div style={{...boxStyle, ...borderStyle}}>
      {/* 只有可拖拽元素且非编辑状态才显示手柄 */}
      {editType !== 'inline' && !isDragging && (
        <>
          {/* 拖拽手柄 */}
          <DragHandle onDragStart={handleDrag} />
          
          {/* 8个缩放手柄：四个角 + 四条边的中点 */}
          <ResizeHandle placement="tl" />  {/* 左上 */}
          <ResizeHandle placement="tr" />  {/* 右上 */}
          <ResizeHandle placement="bl" />  {/* 左下 */}
          <ResizeHandle placement="br" />  {/* 右下 */}
          <ResizeHandle placement="tc" />  {/* 上中 */}
          <ResizeHandle placement="bc" />  {/* 下中 */}
          <ResizeHandle placement="lc" />  {/* 左中 */}
          <ResizeHandle placement="rc" />  {/* 右中 */}
          
          {/* 四条边的拖拽线 */}
          <DragLine placement="t" />  {/* 上边 */}
          <DragLine placement="l" />  {/* 左边 */}
          <DragLine placement="b" />  {/* 下边 */}
          <DragLine placement="r" />  {/* 右边 */}
        </>
      )}
    </div>
  );
}

// 拖拽手柄（带缩放补偿）
function DragHandle({ boxRef, editableType, onSnap, snappable, onMove }) {
  const { scale } = useStore(state => ({ scale: state.scale }));
  const handleRef = useRef(null);
  const { handleMouseDown } = useDragMove({
    boxRef,
    onSnap,
    snappable,
    onChange: onMove,
  });
  
  // 获取手柄尺寸
  const handleSize = useElementSize(handleRef);
  
  // 缩放补偿：由于 iframe 缩放，手柄也会变小，需要反向缩放保持大小
  useEffect(() => {
    const element = handleRef.current;
    if (!handleSize?.width || !handleSize?.height || !element) return;
    
    // 计算补偿后的尺寸
    const compensatedWidth = handleSize.width / scale;
    const compensatedHeight = handleSize.height / scale;
    
    // 计算偏移量（居中对齐）
    const offsetX = (compensatedWidth - handleSize.width) / 2;
    const offsetY = (compensatedHeight - handleSize.height) / 2;
    
    // 应用 transform 补偿缩放
    element.style.transform = `translate(${offsetX}px, ${offsetY - compensatedHeight}px) scale(${1 / scale})`;
  }, [handleSize?.width, handleSize?.height, scale]);
  
  return (
    <div
      ref={handleRef}
      className="select-box__drag-handle"
      contentEditable={false}
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        top: '-20px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '4px 8px',
        backgroundColor: '#596CFF',
        color: 'white',
        borderRadius: '4px',
        fontSize: '12px',
        whiteSpace: 'nowrap',
        cursor: 'move',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <DragIcon size={12} />
      <div>{TYPE_NAMES[editableType]}</div>
    </div>
  );
}

// 边线拖拽手柄
function DragLine({ placement, boxRef, onSnap, snappable, onMove }) {
  const { scale } = useStore(state => ({ scale: state.scale }));
  const lineRef = useRef(null);
  const { handleMouseDown } = useDragMove({
    boxRef,
    onSnap,
    snappable,
    onChange: onMove,
  });
  
  const lineSize = useElementSize(lineRef);
  
  // 根据方向应用不同的缩放补偿
  useEffect(() => {
    const element = lineRef.current;
    if (!lineSize?.width || !lineSize?.height || !element) return;
    
    const compensatedWidth = lineSize.width / scale;
    const compensatedHeight = lineSize.height / scale;
    const offsetX = (compensatedWidth - lineSize.width) / 2;
    const offsetY = (compensatedHeight - lineSize.height) / 2;
    
    // 垂直线只补偿 Y 方向，水平线只补偿 X 方向
    if (placement === 't' || placement === 'b') {
      element.style.transform = `translateY(${offsetY}px) scaleY(${1 / scale})`;
    } else if (placement === 'l' || placement === 'r') {
      element.style.transform = `translateX(${offsetX}px) scaleX(${1 / scale})`;
    }
  }, [lineSize?.width, lineSize?.height, scale, placement]);
  
  return (
    <div
      ref={lineRef}
      className={`select-box__drag-line-handle select-box__drag-line-handle-${placement}`}
      onMouseDown={handleMouseDown}
    />
  );
}
```

## 四、文本编辑实现

### 4.1 文本编辑模式

```javascript
function useTextEditing({ element, onFinishEditing }) {
  const [isEditing, setIsEditing] = useState(false);
  
  // 双击进入编辑
  const handleDoubleClick = () => {
    if (getEditableType(element) !== 'text') return;
    
    setIsEditing(true);
    
    // 设置元素可编辑
    element.contentEditable = true;
    element.style.setProperty('outline', 'none', 'important');
    element.focus();
    
    // 选中所有文本
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  
  // 失焦退出编辑
  const handleBlur = () => {
    const newContent = element.innerHTML;
    
    if (newContent !== originalContent) {
      element.contentEditable = false;
      setIsEditing(false);
      
      // 保存编辑结果
      onFinishEditing({
        type: 'text-change',
        elementId: element.id,
        content: newContent,
      });
    }
  };
  
  useEffect(() => {
    if (isEditing) {
      element.addEventListener('blur', handleBlur);
      return () => element.removeEventListener('blur', handleBlur);
    }
  }, [isEditing]);
  
  return { isEditing, handleDoubleClick };
}
```

### 4.2 文本选中监听

监听 iframe 内的文本选择状态，用于显示文本样式工具栏：

```javascript
function useSelectionTracking(enabled, iframeDoc) {
  const setSelectionRect = useStore(state => state.setSelectionRect);
  const setHasSelection = useStore(state => state.setHasSelection);
  
  useEffect(() => {
    const handleSelectionChange = () => {
      if (!enabled || !iframeDoc) return;
      
      // 排除输入框和文本域
      if (iframeDoc.activeElement?.tagName === 'INPUT' ||
          iframeDoc.activeElement?.tagName === 'TEXTAREA') {
        setSelectionRect(null);
        setHasSelection(false);
        return;
      }
      
      const selection = iframeDoc.getSelection();
      
      // 检查是否有有效的选中文本
      if (!selection || 
          selection.toString().trim() === '' ||
          selection.rangeCount === 0 ||
          selection.isCollapsed) {
        setSelectionRect(null);
        setHasSelection(false);
        return;
      }
      
      // 获取选中范围的位置信息
      const range = selection.getRangeAt(selection.rangeCount - 1);
      const rect = range.getBoundingClientRect();
      
      setSelectionRect(rect);
      setHasSelection(true);
    };
    
    // 监听 selectionchange 事件
    iframeDoc?.addEventListener('selectionchange', handleSelectionChange);
    
    return () => {
      iframeDoc?.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [iframeDoc, enabled]);
}
```

### 4.3 部分文本样式修改核心算法

这是最复杂的部分，实现了对部分文本设置不同样式的功能（如"美团财报"中对不同字设置不同样式）。

#### 4.3.1 获取选中文本的当前样式

```javascript
// 扩展 Document 原型，添加获取选中文本样式的方法
Document.prototype.getSelectionStyleValue = async function(styleProp) {
  const selection = this.defaultView?.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;
  
  // 获取选中范围内的所有文本节点
  const textNodes = getTextNodesInRange(range);
  if (textNodes.length === 0) return null;
  
  // 获取第一个文本节点的父元素样式
  const firstParent = textNodes[0].parentElement;
  if (!firstParent) return null;
  
  const computedStyle = window.getComputedStyle(firstParent);
  return computedStyle[styleProp] || firstParent.style[styleProp];
};
```

#### 4.3.2 样式修改操作类

当用户选中部分文本并修改样式时（如粗体、颜色、斜体），会触发 `selection-style-change` 操作：

```javascript
// 样式修改操作类
const createStyleChangeOperation = (context, value) => {
  const { document: iframeDoc } = context;
  
  if (!iframeDoc) {
    return {
      redo: () => refreshIframe(context),
      undo: () => refreshIframe(context),
    };
  }
  
  // 存储被修改的元素信息
  const modifiedElements = [];      // 直接修改的元素
  const wrappedElements = [];        // 新创建的包裹元素
  
  // 获取当前选中的文本范围
  const selection = iframeDoc.defaultView?.getSelection();
  const selectedRange = selection?.getRangeAt(0);
  const selectedText = selectedRange?.toString();
  
  return {
    // 执行样式修改
    redo: () => {
      Object.entries(value).forEach(([styleProp, styleValue]) => {
        if (!styleValue) return;
        
        applyStyleToSelection(
          iframeDoc, 
          styleProp, 
          styleValue, 
          modifiedElements, 
          wrappedElements
        );
      });
      
      return refreshIframe(context);
    },
    
    // 撤销样式修改
    undo: () => {
      // 恢复直接修改的元素
      modifiedElements.forEach(({ element, key, originalStyle }) => {
        element.style[key] = originalStyle;
      });
      
      // 移除新创建的包裹元素，恢复为原始文本
      wrappedElements.forEach(wrapperElement => {
        const fragment = iframeDoc.createDocumentFragment();
        Array.from(wrapperElement.childNodes).forEach(child => {
          fragment.appendChild(child);
        });
        wrapperElement.replaceWith(fragment);
      });
      
      // 恢复选择范围
      if (selectedRange) {
        restoreSelection(
          selection, 
          selectedText, 
          selectedRange.commonAncestorContainer
        );
      }
      
      return refreshIframe(context);
    },
  };
};
```

#### 4.3.3 应用样式到选中文本

这是最核心的算法，处理了两种情况：
1. **光标位置（未选中文本）**：插入零宽字符
2. **选中部分文本**：分割文本节点并包裹

```javascript
function applyStyleToSelection(
  iframeDoc,
  styleProp,      // 样式属性（如 'color', 'fontWeight'）
  styleValue,     // 样式值（如 'red', 'bold'）
  modifiedElements,
  wrappedElements
) {
  const selection = iframeDoc.defaultView?.getSelection();
  if (!selection || !selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  const selectedText = range.toString();
  
  // ========== 情况 1：光标位置（没有选中文本）==========
  if (range.collapsed) {
    // 查找最近的可样式化父元素
    const targetElement = findStyleableParent(range.startContainer, styleProp);
    
    if (targetElement) {
      // 直接修改现有元素
      targetElement.style[styleProp] = styleValue;
    } else {
      // 创建新的 span 元素
      const span = iframeDoc.createElement('span');
      span.style[styleProp] = styleValue;
      
      // 插入零宽字符（Zero-Width Space: \u200B）
      // 这是一个不可见字符，用于标记光标位置
      const zeroWidthSpace = iframeDoc.createTextNode('\u200B');
      span.appendChild(zeroWidthSpace);
      
      range.insertNode(span);
      range.setStart(zeroWidthSpace, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return;
  }
  
  // ========== 情况 2：选中了部分文本 ==========
  
  // 获取选中范围内的所有文本节点
  const textNodes = getTextNodesInRange(range);
  const processedParents = new Set();
  
  textNodes.forEach(textNode => {
    const { startOffset, endOffset } = calculateTextNodeOffsets(textNode, range);
    const { parentElement } = textNode;
    
    if (!parentElement || processedParents.has(parentElement)) return;
    
    // 判断是否选中了整个父元素
    const isWholeParent = isWholeTextNode(textNode, parentElement, startOffset, endOffset);
    
    if (isWholeParent) {
      // ========== 场景 A：选中整个父元素 ==========
      // 直接修改父元素样式
      modifiedElements.push({
        element: parentElement,
        key: styleProp,
        originalStyle: parentElement.style[styleProp],
      });
      parentElement.style[styleProp] = styleValue;
      processedParents.add(parentElement);
    } else {
      // ========== 场景 B：只选中部分文本 ==========
      // 分割文本节点并包裹选中部分
      splitAndWrapTextNode(
        iframeDoc,
        textNode,
        startOffset,
        endOffset,
        styleProp,
        styleValue,
        wrappedElements
      );
    }
  });
  
  // 恢复选择范围
  restoreSelection(selection, selectedText, range.commonAncestorContainer);
}
```

#### 4.3.4 核心辅助函数

```javascript
// 1. 查找最近的可样式化父元素
function findStyleableParent(node, styleProp) {
  let current = node;
  
  while (current && current.nodeType !== Node.DOCUMENT_NODE) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current;
      
      // 如果已有该样式，或者是常见的文本容器
      if (element.style[styleProp] ||
          ['SPAN', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(element.tagName)) {
        return element;
      }
    }
    current = current.parentNode;
  }
  
  return null;
}

// 2. 获取范围内的所有文本节点
function getTextNodesInRange(range) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        return range.intersectsNode(node) 
          ? NodeFilter.FILTER_ACCEPT 
          : NodeFilter.FILTER_REJECT;
      }
    }
  );
  
  let node = walker.currentNode;
  while (node) {
    if (node.textContent && 
        node.textContent.trim() && 
        node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node);
    }
    node = walker.nextNode();
  }
  
  return textNodes;
}

// 3. 计算文本节点在选中范围中的偏移量
function calculateTextNodeOffsets(textNode, range) {
  const textLength = textNode.textContent?.length || 0;
  let startOffset = 0;
  let endOffset = textLength;
  
  // 如果范围的起始容器就是这个文本节点
  if (range.startContainer === textNode) {
    startOffset = Math.max(0, Math.min(range.startOffset, textLength));
  }
  
  // 如果范围的结束容器就是这个文本节点
  if (range.endContainer === textNode) {
    endOffset = Math.max(0, Math.min(range.endOffset, textLength));
  }
  
  // 确保 startOffset 不大于 endOffset
  if (startOffset > endOffset) {
    startOffset = endOffset;
  }
  
  return { startOffset, endOffset };
}

// 4. 判断是否选中了整个文本节点
function isWholeTextNode(textNode, parentElement, startOffset, endOffset) {
  const textLength = textNode.textContent?.length || 0;
  
  // 检查是否选中了整个文本内容
  if (startOffset !== 0 || endOffset !== textLength) {
    return false;
  }
  
  // 检查父元素是否只有这一个有效子节点
  const validChildren = Array.from(parentElement.childNodes).filter(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.trim();
    }
    return true;
  });
  
  return validChildren.length === 1 && validChildren[0] === textNode;
}

// 5. 分割文本节点并包裹选中部分
function splitAndWrapTextNode(
  iframeDoc,
  textNode,
  startOffset,
  endOffset,
  styleProp,
  styleValue,
  wrappedElements
) {
  const originalText = textNode.textContent || '';
  const { parentElement } = textNode;
  
  if (!parentElement) return;
  
  // 分割文本为三部分：前、中、后
  const beforeText = originalText.substring(0, startOffset);
  const selectedText = originalText.substring(startOffset, endOffset);
  const afterText = originalText.substring(endOffset);
  
  // 创建文档片段
  const fragment = iframeDoc.createDocumentFragment();
  
  // 添加前部分文本
  if (beforeText) {
    fragment.appendChild(iframeDoc.createTextNode(beforeText));
  }
  
  // 添加选中部分（用 span 包裹）
  if (selectedText) {
    const span = iframeDoc.createElement('span');
    span.style[styleProp] = styleValue;
    span.appendChild(iframeDoc.createTextNode(selectedText));
    fragment.appendChild(span);
    wrappedElements.push(span);
  }
  
  // 添加后部分文本
  if (afterText) {
    fragment.appendChild(iframeDoc.createTextNode(afterText));
  }
  
  // 替换原始文本节点
  parentElement.replaceChild(fragment, textNode);
}

// 6. 恢复选择范围
function restoreSelection(selection, selectedText, container) {
  if (!selection || !selectedText || !container) return;
  
  try {
    const range = document.createRange();
    
    // 查找包含选中文本的位置
    const position = findTextPosition(container, selectedText);
    
    if (position) {
      range.setStart(position.startNode, position.startOffset);
      range.setEnd(position.endNode, position.endOffset);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch (error) {
    console.warn('Failed to restore selection:', error);
  }
}

function findTextPosition(container, text) {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let currentOffset = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  let targetStart = 0;
  let targetEnd = targetStart + text.length;
  
  let node = walker.nextNode();
  while (node) {
    const nodeLength = (node.textContent || '').length;
    const nextOffset = currentOffset + nodeLength;
    
    // 找到起始节点
    if (!startNode && nextOffset > targetStart) {
      startNode = node;
      startOffset = targetStart - currentOffset;
    }
    
    // 找到结束节点
    if (startNode && nextOffset >= targetEnd) {
      endNode = node;
      endOffset = targetEnd - currentOffset;
      break;
    }
    
    currentOffset = nextOffset;
    node = walker.nextNode();
  }
  
  if (startNode && endNode && startOffset >= 0 && endOffset >= 0) {
    const startLength = (startNode.textContent || '').length;
    const endLength = (endNode.textContent || '').length;
    
    if (startOffset <= startLength && endOffset <= endLength) {
      return { startNode, startOffset, endNode, endOffset };
    }
  }
  
  return null;
}
```

#### 4.3.5 实际案例："美团财报"的样式设置

假设初始 HTML 为：
```html
<div>美团财报</div>
```

**操作 1：选中"美团财"设置加粗**
- 选中范围：索引 0-3
- 操作：`applyStyleToSelection(doc, 'fontWeight', 'bold', ...)`
- 结果：
```html
<div><span style="font-weight: bold">美团财</span>报</div>
```

**操作 2：选中"财报"设置红色**
- 选中范围：索引 2-4
- 操作：`applyStyleToSelection(doc, 'color', 'red', ...)`
- 分析：
  - 需要分割第一个 span（“美团财”）
  - “美团”保持加粗
  - “财”需要加粗+红色
  - “报”只需要红色
- 结果：
```html
<div>
  <span style="font-weight: bold">美团</span><span style="font-weight: bold; color: red">财</span><span style="color: red">报</span>
</div>
```

**操作 3：选中"团财"设置斜体**
- 选中范围：索引 1-3
- 操作：`applyStyleToSelection(doc, 'fontStyle', 'italic', ...)`
- 分析：
  - 需要分割多个 span
  - “美”保持加粗
  - “团”需要加粗+斜体
  - “财”需要加粗+红色+斜体
  - “报”保持红色
- 结果：
```html
<div>
  <span style="font-weight: bold">美</span><span style="font-weight: bold; font-style: italic">团</span><span style="font-weight: bold; color: red; font-style: italic">财</span><span style="color: red">报</span>
</div>
```

这就是 Coze 实现复杂文本样式编辑的核心原理！

## 五、图表编辑实现

### 5.1 图表编辑对话框

```javascript
function ChartEditor({ chartElement, iframeWindow }) {
  const [isOpen, setIsOpen] = useState(false);
  const [chartData, setChartData] = useState(null);
  
  // 打开编辑器时读取当前数据
  const openEditor = () => {
    const chartId = chartElement.id;
    
    // 从 iframe 中获取图表数据
    const data = iframeWindow.UPDATED_DATA_MAP?.[chartId];
    setChartData(data);
    setIsOpen(true);
  };
  
  // 保存编辑结果
  const handleSave = (newData) => {
    const chartId = chartElement.id;
    
    // 发送消息给 iframe 更新图表
    iframeWindow.postMessage({
      type: 'edit-chart',
      chartId,
      data: newData,
      options: { he_forceOption: true },  // ECharts 强制更新标志
      key: SECURITY_KEY,
    }, '*');
    
    setIsOpen(false);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <ChartDataEditor 
          initialData={chartData}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  );
}
```

### 5.2 iframe 接收图表编辑消息

```javascript
// 在 iframe 内部
window.addEventListener('message', (event) => {
  if (event.data.key !== SECURITY_KEY) return;
  
  if (event.data.type === 'edit-chart') {
    const { chartId, data, options } = event.data;
    
    // 更新数据存储
    UPDATED_DATA_MAP[chartId] = data;
    
    // 根据图表类型更新
    if (chartElement.dataset.he_chart_container_echarts === 'true') {
      // ECharts 更新
      const chartInstance = echarts.getInstanceByDom(chartElement);
      chartInstance?.setOption(data, options);
    } else if (chartElement.dataset.he_chart_container_chartjs === 'true') {
      // Chart.js 更新
      const chartInstance = Chart.getChart(chartElement);
      chartInstance?.update();
    }
  }
});
```

## 六、操作历史与撤销重做

### 6.1 样式修改操作

```javascript
// 样式修改操作类
const createStyleChangeOperation = (context, value) => {
  const { document: iframeDoc } = context;
  
  if (!iframeDoc) {
    return {
      redo: () => refreshIframe(context),
      undo: () => refreshIframe(context),
    };
  }
  
  // 存储被修改的元素信息
  const modifiedElements = [];      // 直接修改的元素
  const wrappedElements = [];        // 新创建的包裹元素
  
  // 获取当前选中的文本范围
  const selection = iframeDoc.defaultView?.getSelection();
  const selectedRange = selection?.getRangeAt(0);
  const selectedText = selectedRange?.toString();
  
  return {
    // 执行样式修改
    redo: () => {
      Object.entries(value).forEach(([styleProp, styleValue]) => {
        if (!styleValue) return;
        
        applyStyleToSelection(
          iframeDoc, 
          styleProp, 
          styleValue, 
          modifiedElements, 
          wrappedElements
        );
      });
      
      return refreshIframe(context);
    },
    
    // 撤销样式修改
    undo: () => {
      // 恢复直接修改的元素
      modifiedElements.forEach(({ element, key, originalStyle }) => {
        element.style[key] = originalStyle;
      });
      
      // 移除新创建的包裹元素
      wrappedElements.forEach(wrapperElement => {
        const fragment = iframeDoc.createDocumentFragment();
        Array.from(wrapperElement.childNodes).forEach(child => {
          fragment.appendChild(child);
        });
        wrapperElement.replaceWith(fragment);
      });
      
      // 恢复选择
      if (selectedRange) {
        restoreSelection(
          selection, 
          selectedText, 
          selectedRange.commonAncestorContainer
        );
      }
      
      return refreshIframe(context);
    },
  };
};

// 应用样式到选中文本
function applyStyleToSelection(
  iframeDoc,
  styleProp,
  styleValue,
  modifiedElements,
  wrappedElements
) {
  const selection = iframeDoc.defaultView?.getSelection();
  if (!selection || !selection.rangeCount) return;
  
  const range = selection.getRangeAt(0);
  const selectedText = range.toString();
  
  // 如果选择为空（光标位置）
  if (range.collapsed) {
    // 查找最近的可样式化父元素
    const targetElement = findStyleableParent(range.startContainer, styleProp);
    
    if (targetElement) {
      // 直接修改现有元素
      targetElement.style[styleProp] = styleValue;
    } else {
      // 创建新的 span 元素
      const span = iframeDoc.createElement('span');
      span.style[styleProp] = styleValue;
      
      // 插入零宽字符（Zero-Width Space）
      const zeroWidthSpace = iframeDoc.createTextNode('\u200B');
      span.appendChild(zeroWidthSpace);
      
      range.insertNode(span);
      range.setStart(zeroWidthSpace, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return;
  }
  
  // 获取选中范围内的所有文本节点
  const textNodes = getTextNodesInRange(range);
  const processedParents = new Set();
  
  textNodes.forEach(textNode => {
    const { startOffset, endOffset } = calculateTextNodeOffsets(textNode, range);
    const { parentElement } = textNode;
    
    if (!parentElement || processedParents.has(parentElement)) return;
    
    // 判断是否选中了整个父元素
    const isWholeParent = isWholeTextNode(textNode, parentElement, startOffset, endOffset);
    
    if (isWholeParent) {
      // 直接修改父元素样式
      modifiedElements.push({
        element: parentElement,
        key: styleProp,
        originalStyle: parentElement.style[styleProp],
      });
      parentElement.style[styleProp] = styleValue;
      processedParents.add(parentElement);
    } else {
      // 分割文本节点并包裹选中部分
      splitAndWrapTextNode(
        iframeDoc,
        textNode,
        startOffset,
        endOffset,
        styleProp,
        styleValue,
        wrappedElements
      );
    }
  });
  
  // 恢复选择范围
  restoreSelection(selection, selectedText, range.commonAncestorContainer);
}
```

## 七、PPT 导出功能

### 7.1 导出 HTML 实现

```javascript
function exportPPT(context) {
  const { document: iframeDoc, files } = context;
  
  if (!iframeDoc) return files;
  
  // 1. 确保字体已加载
  if (!iframeDoc.querySelector('#font-douyinmeihao')) {
    const fontLink = iframeDoc.createElement('link');
    fontLink.id = 'font-douyinmeihao';
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.bytedance.com/dfd/api/v1/css?family=DOUYINSANSBOLD-GB:500&display=swap&t=fd8d3e33-ea5c-40c1-a38b-bf6529186903';
    iframeDoc.head.appendChild(fontLink);
  }
  
  // 2. 克隆 DOM 树
  const clonedHTML = iframeDoc.documentElement.cloneNode(true);
  
  // 3. 移除编辑器相关元素
  // 移除选中框和辅助元素
  clonedHTML.querySelectorAll('.select-box').forEach(el => el.remove());
  clonedHTML.querySelectorAll('.helper-box').forEach(el => el.remove());
  
  // 4. 移除 contentEditable 属性
  Array.from(clonedHTML.querySelectorAll('*'))
    .filter(el => el.contentEditable === 'true')
    .forEach(el => {
      el.contentEditable = 'false';
    });
  
  // 5. 清理 Tailwind CSS
  clonedHTML.querySelectorAll('style').forEach(styleEl => {
    const content = styleEl.innerHTML;
    // 移除 Tailwind 授权信息
    if (content.includes('MIT License') && 
        content.includes('https://tailwindcss.com')) {
      styleEl.remove();
    }
  });
  
  // 6. 生成最终 HTML
  const finalHTML = `<!DOCTYPE html>${clonedHTML.outerHTML}`;
  
  return {
    [HTML_CONTENT_KEY]: finalHTML,
  };
}
```

## 八、Transform 处理工具

### 8.1 移除 translate 值

```javascript
// 用于拖拽时移除元素的 translate 值，保留 scale/rotate 等其他变换
function removeTranslateFromTransform(transformString, options = {}) {
  const { addIfMissing = false, resetScale = false } = options;
  
  const trimmed = (transformString || '').trim();
  if (!trimmed) return addIfMissing ? 'translate(0, 0)' : '';
  
  // 解析 transform 函数
  const functions = parseTransformFunctions(trimmed);
  
  const result = [];
  let hasTranslate = false;
  
  for (let [funcName, params, original] of functions) {
    switch (funcName) {
      case 'translate': {
        const values = splitParams(params);
        if (values.length === 0) {
          result.push('translate(0, 0)');
        } else if (values.length === 1) {
          result.push('translate(0)');
        } else {
          // 重置为 0
          values[0] = '0';
          values[1] = '0';
          result.push(`translate(${joinParams(values)})`);
        }
        hasTranslate = true;
        break;
      }
      
      case 'translatex':
        result.push('translateX(0)');
        hasTranslate = true;
        break;
        
      case 'translatey':
        result.push('translateY(0)');
        hasTranslate = true;
        break;
        
      case 'translate3d': {
        const values = splitParams(params);
        if (values.length >= 1) values[0] = '0';
        if (values.length >= 2) values[1] = '0';
        result.push(`translate3d(${joinParams(values)})`);
        hasTranslate = true;
        break;
      }
      
      case 'scale':
      case 'scalex':
      case 'scaley':
      case 'scale3d':
        // 根据 resetScale 决定是否重置
        if (resetScale) {
          if (funcName === 'scale') {
            const values = splitParams(params);
            result.push(values.length <= 1 ? 'scale(1)' : 'scale(1, 1)');
          } else if (funcName === 'scale3d') {
            result.push('scale3d(1, 1, 1)');
          } else {
            result.push(`${funcName}(1)`);
          }
        } else {
          result.push(original);
        }
        break;
        
      default:
        result.push(original);
    }
  }
  
  // 如果没有 translate 且需要添加
  if (!hasTranslate && addIfMissing) {
    result.unshift('translate(0, 0)');
  }
  
  return result.join(' ');
}

// 解析 transform 函数
function parseTransformFunctions(transformString) {
  const regex = /([a-zA-Z0-9]+)\s*\(([^()]*)\)/g;
  const functions = [];
  let match;
  
  while ((match = regex.exec(transformString))) {
    const fullMatch = match[0];
    const funcName = match[1].toLowerCase();
    const params = match[2];
    functions.push([funcName, params, fullMatch]);
  }
  
  return functions;
}
```