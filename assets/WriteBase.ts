import { _decorator, Color, Component, EventTouch, Graphics, JsonAsset, Node, resources, UITransform, Vec2, Vec3 } from "cc";
import { easeInQuad, easeOutQuad, GeometryUtils, StrokeMatcher, StrokeMatchResult } from "./Common";
const { ccclass, property } = _decorator;

interface CharData {
	strokes: string[];
	medians: number[][][];
}

@ccclass("WriteBase")
export class WriteBase extends Component {
	@property({ tooltip: "缩放比例" })
	scale: number = 0.5;

	// ==================== 速度控制 ====================

	@property({ tooltip: "每笔间隔时间（秒）" })
	strokeDelay: number = 0.5;

	@property({ tooltip: "笔触速度（像素/秒）", range: [50, 1000, 10] })
	strokeSpeed: number = 300;

	@property({ tooltip: "速度倍率（全局加速/减速）", range: [0.1, 5, 0.1] })
	speedMultiplier: number = 1.0;

	@property({ tooltip: "笔画颜色" })
	strokeColor: Color = Color.WHITE;

	// ==================== 点密度控制 ====================

	@property({ tooltip: "点采样密度（像素/点，越小越密）", range: [0.5, 20, 0.5] })
	pointDensity: number = 5;

	@property({ tooltip: "最小点间距（像素）", range: [0.5, 10, 0.5] })
	minPointDistance: number = 1;

	@property({ tooltip: "最大点间距（像素）", range: [5, 50, 1] })
	maxPointDistance: number = 12;

	// ==================== 高级笔触参数 ====================

	@property({ tooltip: "最小笔触宽度（基准值）", range: [1, 50, 0.5] })
	minStrokeWidth: number = 20;

	@property({ tooltip: "最大笔触宽度（基准值）", range: [1, 50, 0.5] })
	maxStrokeWidth: number = 30;

	// ==================== Quiz 模式参数 ====================

	@property({ tooltip: "启用 Quiz 模式（书写检测）" })
	quizMode: boolean = false;

	@property({
		tooltip: "Quiz 宽松度（0-2，越大越宽松）",
		range: [0, 2, 0.1],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	quizLeniency: number = 1.0;

	@property({
		tooltip: "起点终点阈值（默认250，越大越宽松）",
		range: [100, 500, 10],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	startEndThreshold: number = 250;

	@property({
		tooltip: "Frechet形状阈值（默认0.5，越大越宽松）",
		range: [0.1, 1, 0.05],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	frechetThreshold: number = 0.5;

	@property({
		tooltip: "最小长度比率（默认0.35）",
		range: [0.1, 0.8, 0.05],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	minLengthRatio: number = 0.35;

	@property({
		tooltip: "最大长度比率（默认2.5）",
		range: [1.0, 5.0, 0.1],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	maxLengthRatio: number = 2.5;

	@property({
		tooltip: "错误几次后显示提示（0表示不显示）",
		range: [0, 10, 1],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	showHintAfterMisses: number = 3;

	@property({
		tooltip: "错误几次后自动通过（0表示不自动）",
		range: [0, 10, 1],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	markCorrectAfterMisses: number = 0;

	@property({
		tooltip: "正确笔画颜色",
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	correctStrokeColor: Color = new Color(100, 255, 100, 255);

	@property({
		tooltip: "错误笔画颜色",
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	wrongStrokeColor: Color = new Color(255, 100, 100, 255);

	@property({
		tooltip: "用户笔画颜色",
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	userStrokeColor: Color = new Color(255, 255, 100, 200);

	@property({
		tooltip: "用户笔画平滑度（0-1，越大越平滑）",
		range: [0, 1, 0.1],
		visible: function (): boolean {
			return this.quizMode;
		},
	})
	userStrokeSmoothness: number = 0.9;

	@property({
		tooltip: "显示临摹原型",
	})
	showBase: boolean = true;

	@property({
		tooltip: "临摹原型颜色",
		visible: function (): boolean {
			return this.showBase;
		},
	})
	baseColor: Color = new Color(100, 100, 100, 80);
	// ==================== DEBUG ====================

	@property({ tooltip: "显示笔触轨迹点（调试用）" })
	showDebugPoints: boolean = false;

	@property({ tooltip: "显示 Median 关键点（调试用）" })
	showMedianPoints: boolean = false;
	// HanziWriter的标准viewBox大小
	protected readonly SVG_SIZE: number = 1024;
	protected readonly startSpeedRatio: number = 0.3; // 起笔时速度为30%
	protected readonly endSpeedRatio: number = 0.4; // 收笔时速度为40%
	protected readonly startStrokeRatio: number = 0.15; // 起笔阶段占15%
	protected readonly endStrokeRatio: number = 0.15; // 收笔阶段占15%

	// 存储笔画的边界框
	public bounds: { minX: number; minY: number; maxX: number; maxY: number } = null;

	protected charData: CharData = null;
	protected currentStrokeIndex: number = 0;
	protected currentStrokeProgress: number = 0;
	protected currentStrokeDuration: number = 0;
	protected currentMedians: number[][] = [];
	protected strokePoints: Array<{ pos: Vec2; width: number }> = [];

	// 书写记录：保存每一笔的完整数据
	protected strokeHistory: Array<{
		strokeIndex: number;
		points: Array<{ pos: Vec2; width: number }>;
	}> = [];

	protected strokeGraphics: {
		[index: number]: {
			graphics: Graphics;
			points: Array<{ pos: Vec2; width: number }>;
		};
	} = {};

	// Quiz 模式相关变量
	protected quizActive: boolean = false;
	protected userStroke: Vec2[] = [];
	protected mistakesOnStroke: number = 0;
	protected totalMistakes: number = 0;
	protected isTouching: boolean = false;
	protected quizStartTime: number = 0;
	protected strokeQualityScores: number[] = []; // 每笔的质量得分

	public pointIndex: number = 0;
	public currentStrokeColor: Color = Color.WHITE;
	public isAuto: boolean = false;
	public isDrawing: boolean = false;

	start() {}

	setCharData(charData: CharData) {
		this.charData = charData;
	}

	loadCharData(char: string, cb: () => void) {
		// 加载汉字数据
		resources.load(`hanzi-writer-data/${char}`, JsonAsset, (err, asset: JsonAsset) => {
			if (err) {
				console.error("加载汉字数据失败:", err);
				return;
			}

			this.charData = asset.json as CharData;
			console.log(this.charData);
			this.calculateBounds();

			cb();
		});
	}

	/**
	 * 绘制临摹原型（完整的汉字轮廓）
	 */
	drawBaseCharacter(target: Graphics, fillColor: Color, strokeColor?: Color) {
		if (!target || !this.charData) {
			return;
		}

		target.clear();
		target.fillColor = fillColor;
		target.strokeColor = strokeColor || fillColor;

		// 绘制所有笔画
		for (const stroke of this.charData.strokes) {
			this.drawSVGPath(stroke, target);
		}
	}

	/**
	 * 解析并绘制 SVG 路径
	 */
	drawSVGPath(pathData: string, graphics: Graphics) {
		const commands = this.parseSVGPath(pathData);
		let currentX = 0;
		let currentY = 0;
		let startX = 0;
		let startY = 0;

		for (const cmd of commands) {
			switch (cmd.type) {
				case "M": // MoveTo
					currentX = cmd.x;
					currentY = cmd.y;
					startX = currentX;
					startY = currentY;
					graphics.moveTo(this.transformX(currentX), this.transformY(currentY));
					break;

				case "L": // LineTo
					currentX = cmd.x;
					currentY = cmd.y;
					graphics.lineTo(this.transformX(currentX), this.transformY(currentY));
					break;

				case "Q": // QuadraticCurveTo
					graphics.quadraticCurveTo(this.transformX(cmd.x1), this.transformY(cmd.y1), this.transformX(cmd.x), this.transformY(cmd.y));
					currentX = cmd.x;
					currentY = cmd.y;
					break;

				case "C": // BezierCurveTo
					graphics.bezierCurveTo(
						this.transformX(cmd.x1),
						this.transformY(cmd.y1),
						this.transformX(cmd.x2),
						this.transformY(cmd.y2),
						this.transformX(cmd.x),
						this.transformY(cmd.y)
					);
					currentX = cmd.x;
					currentY = cmd.y;
					break;

				case "Z": // ClosePath
					graphics.lineTo(this.transformX(startX), this.transformY(startY));
					graphics.close();
					break;
			}
		}

		graphics.fill();
	}

	/** 将SVG的X坐标转换为Cocos坐标系 */
	transformX(x: number): number {
		const centerX = this.bounds ? (this.bounds.minX + this.bounds.maxX) / 2 : this.SVG_SIZE / 2;
		return (x - centerX) * this.scale;
	}

	/** 将SVG的Y坐标转换为Cocos坐标系 */
	transformY(y: number): number {
		const centerY = this.bounds ? (this.bounds.minY + this.bounds.maxY) / 2 : this.SVG_SIZE / 2;
		return (y - centerY) * this.scale;
	}

	/**
	 * 解析 SVG 路径字符串
	 */
	parseSVGPath(pathData: string): Array<any> {
		const commands: Array<any> = [];
		const regex = /([MLQCZ])([^MLQCZ]*)/gi;
		let match;

		while ((match = regex.exec(pathData)) !== null) {
			const type = match[1].toUpperCase();
			const args = match[2]
				.trim()
				.split(/[\s,]+/)
				.filter((s) => s.length > 0)
				.map(parseFloat);

			switch (type) {
				case "M":
					commands.push({ type: "M", x: args[0], y: args[1] });
					break;
				case "L":
					commands.push({ type: "L", x: args[0], y: args[1] });
					break;
				case "Q":
					commands.push({ type: "Q", x1: args[0], y1: args[1], x: args[2], y: args[3] });
					break;
				case "C":
					commands.push({ type: "C", x1: args[0], y1: args[1], x2: args[2], y2: args[3], x: args[4], y: args[5] });
					break;
				case "Z":
					commands.push({ type: "Z" });
					break;
			}
		}

		return commands;
	}

	/**
	 * 绘制田字格
	 */
	drawGrid(target: Graphics, scale: number) {
		if (!target) {
			console.warn("⚠️ bg Graphics 节点未绑定！");
			return;
		}

		target.clear();
		target.lineWidth = 2;

		// 计算田字格的大小
		let gridSize: number = this.SVG_SIZE * scale;

		if (this.bounds) {
			// 根据实际汉字边界框大小来确定田字格大小
			const width = this.bounds.maxX - this.bounds.minX;
			const height = this.bounds.maxY - this.bounds.minY;
			gridSize = Math.max(width, height) * scale * 1.2; // 留出20%的边距
		}

		const halfSize = gridSize / 2;

		target.rect(-halfSize, -halfSize, gridSize, gridSize);
		// 绘制对角线
		target.moveTo(-halfSize, -halfSize);
		target.lineTo(halfSize, halfSize);
		target.moveTo(-halfSize, halfSize);
		target.lineTo(halfSize, -halfSize);
		// 绘制横竖中线
		target.moveTo(-halfSize, 0);
		target.lineTo(halfSize, 0);
		target.moveTo(0, -halfSize);
		target.lineTo(0, halfSize);

		target.stroke();
	}

	/**
	 * 计算所有笔画的边界框
	 */
	calculateBounds() {
		if (!this.charData || !this.charData.medians) {
			return;
		}

		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;

		// 遍历所有笔画的 medians 数据
		for (const median of this.charData.medians) {
			for (const point of median) {
				const x = point[0];
				const y = point[1];

				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}

		this.bounds = { minX, minY, maxX, maxY };
	}

	/** 将触摸位置转换为 Graphics 节点坐标 */
	getTouchPositionInGraphics(event: EventTouch, target: Node): Vec2 | null {
		const touchPos = event.getUILocation();
		const graphicsTransform = target.getComponent(UITransform);
		if (!graphicsTransform) return null;

		// 将屏幕坐标转换为 graphics 节点的本地坐标
		const localPos = graphicsTransform.convertToNodeSpaceAR(new Vec3(touchPos.x, touchPos.y, 0));
		return new Vec2(localPos.x, localPos.y);
	}

	/**
	 * 计算 medians 路径长度
	 */
	calculateMediansLength(medians: number[][]): number {
		let length = 0;
		for (let i = 1; i < medians.length; i++) {
			const dx = medians[i][0] - medians[i - 1][0];
			const dy = medians[i][1] - medians[i - 1][1];
			length += Math.sqrt(dx * dx + dy * dy);
		}
		return length;
	}

	/**
	 * 绘制单笔画
	 */
	drawStroke(targetIndex: number, color?: Color) {
		if (this.isDrawing) return;
		if (!this.charData || targetIndex >= this.charData.strokes.length) {
			return;
		}
		this.currentStrokeColor = color || this.strokeColor;
		this.currentStrokeIndex = targetIndex;
		this.isAuto = true;
		this.isDrawing = true;
		this.currentStrokeProgress = 0;
		this.strokePoints = [];

		// 获取当前笔画的 medians 数据
		this.currentMedians = this.charData.medians[targetIndex];

		// 计算笔画长度和时长（考虑速度倍率）
		const strokeLength = this.calculateMediansLength(this.currentMedians);
		const baseSpeed = this.strokeSpeed * this.speedMultiplier;

		// 使用速度缓动，需要计算平均速度
		// 计算加权平均速度
		const avgSpeedRatio =
			this.startSpeedRatio * this.startStrokeRatio + 1.0 * (1 - this.startStrokeRatio - this.endStrokeRatio) + this.endSpeedRatio * this.endStrokeRatio;
		this.currentStrokeDuration = strokeLength / (baseSpeed * avgSpeedRatio);
	}

	/**
	 * 平滑绘制笔画（填充点之间的间隙）
	 */
	drawSmoothStroke(points: Array<{ pos: Vec2; width: number }>, graphics: Graphics, color: Color) {
		if (points.length === 0) return;

		graphics.fillColor = color;

		// 绘制第一个点
		graphics.circle(points[0].pos.x, points[0].pos.y, points[0].width / 2);
		graphics.fill();

		// 在相邻点之间插值绘制
		for (let i = 1; i < points.length; i++) {
			const p1 = points[i - 1];
			const p2 = points[i];

			const distance = Vec2.distance(p1.pos, p2.pos);
			const avgWidth = (p1.width + p2.width) / 2;

			// 计算需要插值的数量：确保圆形之间有足够的重叠
			const numSteps = Math.max(1, Math.ceil(distance / (avgWidth * 0.5)));

			// 在两点之间插值
			for (let step = 0; step <= numSteps; step++) {
				const t = step / numSteps;
				const x = p1.pos.x + (p2.pos.x - p1.pos.x) * t;
				const y = p1.pos.y + (p2.pos.y - p1.pos.y) * t;
				const width = p1.width + (p2.width - p1.width) * t;

				graphics.circle(x, y, width / 2);
				graphics.fill();
			}
		}
	}

	/**
	 * 根据进度获取路径上的点
	 */
	getPointAtProgress(medians: number[][], progress: number): Vec2 {
		const totalLength = this.calculateMediansLength(medians);
		const targetLength = totalLength * progress;

		let accumulatedLength = 0;
		for (let i = 1; i < medians.length; i++) {
			const [x0, y0] = medians[i - 1];
			const [x1, y1] = medians[i];
			const segmentLength = Math.sqrt(Math.pow(x1 - x0, 2) + Math.pow(y1 - y0, 2));

			if (accumulatedLength + segmentLength >= targetLength) {
				// 在这段内
				const ratio = (targetLength - accumulatedLength) / segmentLength;
				const x = x0 + (x1 - x0) * ratio;
				const y = y0 + (y1 - y0) * ratio;
				return new Vec2(this.transformX(x), this.transformY(y));
			}

			accumulatedLength += segmentLength;
		}

		// 末尾点
		const lastPoint = medians[medians.length - 1];
		return new Vec2(this.transformX(lastPoint[0]), this.transformY(lastPoint[1]));
	}

	/** 验证用户笔画 */
	validateUserStroke(correctCb: (qualityScore: number) => void, mistakeCb: () => void) {
		if (!this.charData || this.currentStrokeIndex >= this.charData.medians.length) return;

		// 获取当前应该书写的笔画的 median 点
		const targetMedian = this.charData.medians[this.currentStrokeIndex];
		const targetPoints = targetMedian.map((pt: number[]) => new Vec2(this.transformX(pt[0]), this.transformY(pt[1])));

		// 预处理所有笔画点（用于检测顺序错误）
		const allStrokePoints: Vec2[][] = this.charData.medians.map((median: number[][]) =>
			median.map((pt: number[]) => new Vec2(this.transformX(pt[0]), this.transformY(pt[1])))
		);

		// 使用增强的笔画匹配算法
		const hasDrawnStrokes = this.currentStrokeIndex > 0;
		const matchResult = StrokeMatcher.matchStroke(
			this.userStroke,
			targetPoints,
			this.quizLeniency,
			350 * this.scale, // 根据缩放调整阈值
			allStrokePoints, // 传入所有笔画用于顺序检测
			this.currentStrokeIndex,
			hasDrawnStrokes, // 已画过笔画时更严格
			{
				startEndThreshold: this.startEndThreshold,
				frechetThreshold: this.frechetThreshold,
				minLengthRatio: this.minLengthRatio,
				maxLengthRatio: this.maxLengthRatio,
			}
		);

		// 计算笔画质量得分（0-100）
		const qualityScore = this.calculateStrokeQualityScore(matchResult, targetPoints);

		// 判断是否接受
		const isAccepted = matchResult.isMatch || (this.markCorrectAfterMisses > 0 && this.mistakesOnStroke + 1 >= this.markCorrectAfterMisses);

		if (isAccepted) correctCb(qualityScore);
		else mistakeCb();
	}

	/** 计算当前进度对应的笔触宽度 */
	getStrokeWidthAtProgress(progress: number): number {
		let width = this.minStrokeWidth;

		if (progress < this.startStrokeRatio) {
			const t = easeOutQuad(progress / this.startStrokeRatio);
			width = this.minStrokeWidth + (this.maxStrokeWidth - this.minStrokeWidth) * t;
		} else if (progress > 1 - this.endStrokeRatio) {
			const t = easeInQuad((progress - (1 - this.endStrokeRatio)) / this.endStrokeRatio);
			width = this.maxStrokeWidth - (this.maxStrokeWidth - this.minStrokeWidth) * t;
		} else {
			width = this.maxStrokeWidth + Math.sin(progress * Math.PI * 4) * 0.5;
		}

		return width * this.scale;
	}

	/**
	 * 绘制变宽度笔触
	 */
	drawVariableWidthStroke(graphics: Graphics, color: Color) {
		// 清空画布
		graphics.clear();

		// 再绘制当前正在进行的笔画
		if (this.strokePoints.length < 1) return;

		// 绘制笔画点，并在相邻点之间插值填充间隙
		this.drawSmoothStroke(this.strokePoints, graphics, color);

		// 调试：显示轨迹点
		if (this.showDebugPoints) {
			this.strokePoints.forEach((point, i) => {
				graphics.fillColor = i === 0 ? Color.GREEN : i === this.strokePoints.length - 1 ? Color.RED : Color.YELLOW;
				graphics.circle(point.pos.x, point.pos.y, 3);
				graphics.fill();
			});
		}

		// 调试：显示 Median 关键点（蓝色）
		if (this.showMedianPoints && this.currentMedians) {
			for (const median of this.currentMedians) {
				const x = this.transformX(median[0]);
				const y = this.transformY(median[1]);
				graphics.fillColor = Color.BLUE;
				graphics.circle(x, y, 4);
				graphics.fill();
			}
		}
	}

	/** 绘制用户笔画 */
	drawUserStroke(target: Graphics) {
		if (this.userStroke.length < 2) return;

		// 清空并重新绘制
		target.clear();
		this.drawHistoryStrokes(target, this.strokeColor);

		// 绘制用户当前笔画 - 使用平滑曲线
		target.strokeColor = this.userStrokeColor;
		target.fillColor = this.userStrokeColor;
		target.lineWidth = 50 * this.scale;

		if (this.userStroke.length === 2) {
			// 只有两个点时，直接画直线
			target.moveTo(this.userStroke[0].x, this.userStroke[0].y);
			target.lineTo(this.userStroke[1].x, this.userStroke[1].y);
			target.stroke();
		} else {
			// 多个点时，使用二次贝塞尔曲线平滑连接
			target.moveTo(this.userStroke[0].x, this.userStroke[0].y);

			for (let i = 1; i < this.userStroke.length - 1; i++) {
				const current = this.userStroke[i];
				const next = this.userStroke[i + 1];
				// 使用当前点和下一个点的中点作为终点
				const midX = (current.x + next.x) / 2;
				const midY = (current.y + next.y) / 2;
				target.quadraticCurveTo(current.x, current.y, midX, midY);
			}

			// 连接到最后一个点
			const last = this.userStroke[this.userStroke.length - 1];
			const secondLast = this.userStroke[this.userStroke.length - 2];
			target.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
			target.stroke();
		}
	}

	/**
	 * 绘制历史记录中的所有笔画
	 */
	drawHistoryStrokes(target: Graphics, color: Color) {
		for (const record of this.strokeHistory) {
			// 使用平滑绘制方法
			this.drawSmoothStroke(record.points, target, color);
		}
	}

	/** 计算当前进度对应的速度倍率 */
	getSpeedMultiplierAtProgress(progress: number): number {
		if (progress < this.startStrokeRatio) {
			const t = progress / this.startStrokeRatio;
			return this.startSpeedRatio + (1.0 - this.startSpeedRatio) * easeOutQuad(t);
		}
		if (progress > 1 - this.endStrokeRatio) {
			const t = (progress - (1 - this.endStrokeRatio)) / this.endStrokeRatio;
			return 1.0 - (1.0 - this.endSpeedRatio) * easeInQuad(t);
		}
		return 1.0;
	}

	/**
	 * 获取应用缩放后的最小笔触宽度
	 */
	getScaledMinWidth(): number {
		return this.minStrokeWidth * this.scale;
	}

	// ==================== 评分系统 ====================

	/** 计算单个笔画的质量得分（0-100）*/
	calculateStrokeQualityScore(matchResult: StrokeMatchResult, targetPoints: Vec2[]): number {
		// 基础分 60 分
		let score = 60;

		// 平均距离得分（最高 25 分）
		const avgDistScore = Math.max(0, 25 - matchResult.avgDistance / 10);
		score += avgDistScore;

		// 起点终点准确度（最高 15 分）
		if (this.userStroke.length > 0 && targetPoints.length > 0) {
			const startDist = GeometryUtils.distance(this.userStroke[0], targetPoints[0]);
			const endDist = GeometryUtils.distance(this.userStroke[this.userStroke.length - 1], targetPoints[targetPoints.length - 1]);
			const startScore = Math.max(0, 7.5 - startDist / 20);
			const endScore = Math.max(0, 7.5 - endDist / 20);
			score += startScore + endScore;
		}

		// 扣除错误次数的惩罚
		const mistakePenalty = this.mistakesOnStroke * 5;
		score -= mistakePenalty;

		// 限制在 0-100 范围内
		return Math.max(0, Math.min(100, score));
	}

	/** Quiz 完成 */
	onQuizComplete() {
		this.quizActive = false;
		const totalTime = (Date.now() - this.quizStartTime) / 1000; // 秒

		// 计算最终得分
		const finalScore = this.calculateFinalScore(totalTime);

		console.log(`\n🎉 ===== Quiz 完成！=====`);
		console.log(`⏱️  总用时: ${totalTime.toFixed(1)}秒`);
		console.log(`❌ 总错误: ${this.totalMistakes}次`);
		console.log(`📊 最终得分: ${finalScore.totalScore.toFixed(1)}分`);
		console.log(`\n📈 得分详情:`);
		console.log(`  - 准确度: ${finalScore.accuracyScore.toFixed(1)}分 (权重40%)`);
		console.log(`  - 质量度: ${finalScore.qualityScore.toFixed(1)}分 (权重40%)`);
		console.log(`  - 速度: ${finalScore.speedScore.toFixed(1)}分 (权重20%)`);
		console.log(`  - 评级: ${finalScore.grade}`);
		console.log(`========================\n`);
	}

	/** 计算最终得分 */
	calculateFinalScore(totalTime: number): {
		totalScore: number;
		accuracyScore: number;
		qualityScore: number;
		speedScore: number;
		grade: string;
	} {
		const totalStrokes = this.charData.strokes.length;

		// 1. 准确度得分（40%权重）- 基于错误次数
		let accuracyScore = 100;
		// 每个错误扣 10 分
		accuracyScore -= this.totalMistakes * 10;
		accuracyScore = Math.max(0, Math.min(100, accuracyScore));

		// 2. 质量得分（40%权重）- 基于每笔的平均质量
		let qualityScore = 0;
		if (this.strokeQualityScores.length > 0) {
			qualityScore = this.strokeQualityScores.reduce((a, b) => a + b, 0) / this.strokeQualityScores.length;
		}

		// 3. 速度得分（20%权重）- 基于书写时间
		// 假设理想时间是每笔 3-5 秒
		const idealTime = totalStrokes * 4; // 每笔 4 秒
		const timeRatio = idealTime / totalTime;
		let speedScore = 100;
		if (timeRatio < 0.5) {
			// 太快，可能质量不好
			speedScore = timeRatio * 2 * 100;
		} else if (timeRatio > 2) {
			// 太慢
			speedScore = Math.max(60, 100 - (timeRatio - 2) * 20);
		} else {
			// 合理范围内
			speedScore = 100;
		}
		speedScore = Math.max(0, Math.min(100, speedScore));

		// 4. 计算总分（加权平均）
		const totalScore = accuracyScore * 0.4 + qualityScore * 0.4 + speedScore * 0.2;

		// 5. 评级
		let grade = "F";
		if (totalScore >= 95) grade = "S";
		else if (totalScore >= 90) grade = "A+";
		else if (totalScore >= 85) grade = "A";
		else if (totalScore >= 80) grade = "A-";
		else if (totalScore >= 75) grade = "B+";
		else if (totalScore >= 70) grade = "B";
		else if (totalScore >= 65) grade = "B-";
		else if (totalScore >= 60) grade = "C+";
		else if (totalScore >= 55) grade = "C";
		else if (totalScore >= 50) grade = "C-";
		else if (totalScore >= 40) grade = "D";

		return {
			totalScore,
			accuracyScore,
			qualityScore,
			speedScore,
			grade,
		};
	}

	update(dt: number) {
		if (this.quizMode) return;
		if (!this.isAuto) return;
		this.currentStrokeProgress += dt / this.currentStrokeDuration;
		if (this.currentStrokeProgress >= 1.0) {
			this.currentStrokeProgress = 1.0;
			this.isAuto = false;
			this.isDrawing = false;
			this.pointIndex = 0;
			if (!this.strokeGraphics[this.currentStrokeIndex].points.length) {
				// 添加最后一个点
				const finalPoint = this.getPointAtProgress(this.currentMedians, 1.0);
				const finalWidth = this.getStrokeWidthAtProgress(1.0);
				this.strokePoints.push({ pos: finalPoint, width: finalWidth });

				// 💾 保存当前笔画到历史记录
				// 深拷贝当前笔画的点数据
				const pointsCopy = this.strokePoints.map((p) => ({
					pos: new Vec2(p.pos.x, p.pos.y),
					width: p.width,
				}));

				this.strokeGraphics[this.currentStrokeIndex].points = pointsCopy;
			}
			this.strokePoints = [];
			if (!this.quizMode) {
				this.scheduleOnce(() => {
					this.drawStroke(this.currentStrokeIndex + 1);
				}, this.strokeDelay);
			} else {
				this.scheduleOnce(() => {
					this.strokeGraphics[this.currentStrokeIndex].graphics.clear();
				}, 0.3);
			}
		} else {
			if (!this.strokeGraphics[this.currentStrokeIndex].points.length) {
				// 动画进行中：添加新的笔触点
				const point = this.getPointAtProgress(this.currentMedians, this.currentStrokeProgress);
				const width = this.getStrokeWidthAtProgress(this.currentStrokeProgress);

				// 计算当前应该的点间距
				let targetDistance = this.pointDensity;

				// 自适应点密度：根据速度调整
				const speedRatio = this.getSpeedMultiplierAtProgress(this.currentStrokeProgress);
				// 速度快时点距大，速度慢时点距小
				targetDistance = this.pointDensity * speedRatio;
				// 限制在最小和最大间距之间
				targetDistance = Math.max(this.minPointDistance, Math.min(this.maxPointDistance, targetDistance));

				// 使用更小的最小距离来避免刚添加关键点后又添加太近的普通点造成错位
				const minAllowedDistance = Math.max(targetDistance, this.getScaledMinWidth() * 0.3);
				const shouldAddPoint =
					this.strokePoints.length === 0 || Vec2.distance(point, this.strokePoints[this.strokePoints.length - 1].pos) >= minAllowedDistance;

				if (shouldAddPoint) {
					this.strokePoints.push({ pos: point, width });
				}
			} else {
				let point = this.strokeGraphics[this.currentStrokeIndex].points[this.pointIndex];
				this.pointIndex++;
				if (point) this.strokePoints.push({ pos: point.pos, width: point.width });
			}

			this.drawVariableWidthStroke(this.strokeGraphics[this.currentStrokeIndex].graphics, this.currentStrokeColor);
		}
	}
}
