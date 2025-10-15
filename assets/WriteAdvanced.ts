import { _decorator, Color, EditBox, EventTouch, Graphics, Node, UITransform, Vec2 } from "cc";
import { GeometryUtils } from "./Common";
import { WriteBase } from "./WriteBase";
const { ccclass, property } = _decorator;

/**
 * 高级汉字书写动画组件
 * 实现更真实的毛笔/钢笔书写效果
 */
@ccclass("WriteAdvanced")
export class WriteAdvanced extends WriteBase {
	@property(Graphics) drawNode: Graphics = null;
	@property(Graphics) base: Graphics = null;
	@property(Graphics) bg: Graphics = null;
	@property(Node) touchNode: Node = null;
	@property(Node) strokesNode: Node = null;
	@property(EditBox) input: EditBox = null;
	@property(EditBox) scaleInput: EditBox = null;

	public char: string = "我";

	onLoad(): void {
		window["write"] = this;
		this.drawNode.lineWidth = this.minStrokeWidth;
		this.drawNode.strokeColor = this.strokeColor;
		this.drawNode.fillColor = this.strokeColor;

		if (this.base) {
			this.base.fillColor = this.baseColor;
			this.base.strokeColor = this.baseColor;
		}

		// 如果启用 Quiz 模式，设置触摸监听
		if (this.touchNode) {
			this.addEvent();
		}
	}

	onDestroy(): void {
		// 清理事件监听
		if (this.touchNode) {
			this.removeEvent();
		}
	}

	addEvent() {
		this.touchNode.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
		this.touchNode.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
		this.touchNode.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
		this.touchNode.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
	}

	removeEvent() {
		this.touchNode.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
		this.touchNode.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
		this.touchNode.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
		this.touchNode.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
	}

	start() {
		this.drawGrid(this.bg, this.scale);
		this.setChar();
	}

	setChar() {
		this.unscheduleAllCallbacks();
		this.currentStrokeProgress = -1;
		let str = this.input.string[0] || this.char;
		this.strokeHistory = [];
		this.loadCharData(str, () => {
			this.char = str;
			this.base.clear();
			this.drawBaseCharacter(this.base, this.baseColor);
			this.strokesNode.removeAllChildren();
			this.strokeGraphics = {};
			const width = this.bounds.maxX - this.bounds.minX;
			const height = this.bounds.maxY - this.bounds.minY;
			let size = Math.max(width, height) * this.scale * 1.2;
			this.touchNode.getComponent(UITransform).setContentSize(size, size);
			for (let i = 0; i < this.charData.strokes.length; i++) {
				let node = new Node();
				node.layer = this.node.layer;
				this.strokesNode.addChild(node);
				this.strokeGraphics[i] = {
					graphics: node.addComponent(Graphics),
					points: [],
				};
			}
			if (this.quizMode) {
				this.startQuiz();
			} else {
				this.drawStroke(0);
			}
		});
	}

	async previewStroke() {
		for (let i = 0; i < this.charData.strokes.length; i++) {
			this.drawNode.clear();
			this.drawNode.fillColor = Color.GREEN;
			this.drawSVGPath(this.charData.strokes[i], this.drawNode);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
		this.drawNode.clear();
	}

	reset(event?: EventTouch, quizMode: boolean = true) {
		this.currentStrokeIndex = 0;
		this.currentStrokeProgress = -1;
		this.pointIndex = 0;
		this.strokePoints = [];
		this.isDrawing = false;
		this.quizMode = quizMode;
		this.strokeHistory = [];
		this.bounds = null;
		this.drawGrid(this.bg, this.scale);
		this.drawNode.clear();
		this.strokesNode.removeAllChildren();
		this.strokeGraphics = {};
		this.setChar();
		this.unscheduleAllCallbacks();
	}

	/** 开始 Quiz 模式 */
	startQuiz() {
		this.quizActive = true;
		this.currentStrokeIndex = 0;
		this.mistakesOnStroke = 0;
		this.totalMistakes = 0;
		this.strokeQualityScores = [];
		this.quizStartTime = Date.now();
		this.drawNode.clear();
	}

	/** 触摸开始 */
	onTouchStart(event: EventTouch) {
		if (!this.quizMode) return;
		if (this.isDrawing) return;
		if (!this.quizActive || !this.charData) return;

		this.isTouching = true;
		this.userStroke = [];

		const pos = this.getTouchPositionInGraphics(event, this.drawNode.node);
		if (pos) {
			this.userStroke.push(pos);
		}
	}

	/** 触摸移动 */
	onTouchMove(event: EventTouch) {
		if (!this.isTouching || !this.quizActive) return;

		const pos = this.getTouchPositionInGraphics(event, this.drawNode.node);
		if (pos) {
			// 采样控制：避免点过于密集
			if (this.userStroke.length > 0) {
				const lastPoint = this.userStroke[this.userStroke.length - 1];
				const distance = GeometryUtils.distance(pos, lastPoint);
				// 只有距离大于最小阈值时才添加新点
				if (distance < 2) {
					return; // 点太近，忽略
				}

				// 应用平滑滤波（指数移动平均）
				if (this.userStrokeSmoothness > 0) {
					const smoothX = lastPoint.x + (pos.x - lastPoint.x) * (1 - this.userStrokeSmoothness);
					const smoothY = lastPoint.y + (pos.y - lastPoint.y) * (1 - this.userStrokeSmoothness);
					this.userStroke.push(new Vec2(smoothX, smoothY));
				} else {
					this.userStroke.push(pos);
				}
			} else {
				this.userStroke.push(pos);
			}

			this.drawUserStroke(this.drawNode);
		}
	}

	/** 触摸结束 */
	onTouchEnd(event: EventTouch) {
		if (!this.isTouching || !this.quizActive) return;

		this.isTouching = false;

		// 验证用户笔画
		if (this.userStroke.length > 1) {
			this.validateUserStroke(this.onStrokeCorrect.bind(this), this.onStrokeMistake.bind(this));
		}

		// 清除用户笔画
		this.userStroke = [];
	}

	/** 笔画正确的处理 */
	onStrokeCorrect(qualityScore: number = 100) {
		// 保存质量得分
		this.strokeQualityScores.push(qualityScore);

		// 保存正确的笔画到历史
		this.saveCorrectStroke();

		// 重置错误计数
		this.mistakesOnStroke = 0;

		// 进入下一笔
		this.currentStrokeIndex++;

		// 清空并重新绘制
		this.drawNode.clear();
		this.drawHistoryStrokes(this.drawNode, this.strokeColor);

		// 检查是否完成所有笔画
		if (this.currentStrokeIndex >= this.charData.strokes.length) {
			this.onQuizComplete();
		}
	}

	/** 笔画错误的处理 */
	onStrokeMistake() {
		this.mistakesOnStroke++;
		this.totalMistakes++;

		// 短暂显示错误颜色
		this.showWrongStrokeFeedback();
	}

	/** 保存正确的笔画 */
	saveCorrectStroke() {
		// 将用户笔画转换为带宽度的点
		const points = this.userStroke.map((pos) => ({
			pos: new Vec2(pos.x, pos.y),
			width: 50 * this.scale,
		}));

		this.strokeHistory.push({
			strokeIndex: this.currentStrokeIndex,
			points: points,
		});
	}

	/** 显示错误反馈 */
	showWrongStrokeFeedback() {
		// 短暂显示错误颜色的笔画
		const originalColor = this.drawNode.strokeColor;
		this.drawNode.strokeColor = this.wrongStrokeColor;

		this.drawNode.moveTo(this.userStroke[0].x, this.userStroke[0].y);
		for (let i = 1; i < this.userStroke.length; i++) {
			this.drawNode.lineTo(this.userStroke[i].x, this.userStroke[i].y);
		}
		this.drawNode.stroke();

		// 500ms 后恢复
		this.scheduleOnce(() => {
			this.drawNode.strokeColor = originalColor;
			this.drawNode.clear();
			this.drawHistoryStrokes(this.drawNode, this.strokeColor);

			// 如果错误次数达到阈值，显示提示
			if (this.showHintAfterMisses > 0 && this.mistakesOnStroke >= this.showHintAfterMisses) {
				/** 显示笔画提示动画 */
				this.drawStroke(this.currentStrokeIndex, this.correctStrokeColor);
			}
		}, 0.5);
	}

	/** 切换临摹原型显示 */
	toggleBase() {
		this.showBase = !this.showBase;
		if (this.base) {
			this.showBase ? this.drawBaseCharacter(this.base, this.baseColor) : this.base.clear();
		}
	}

	setScale() {
		let scale = this.scaleInput.string || this.scale;
		this.scale = isNaN(+scale) ? this.scale : +scale;
		this.reset();
	}

	autoWrite() {
		this.reset(null, false);
	}
}
