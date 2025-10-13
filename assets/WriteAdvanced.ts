import { _decorator, Color, Component, Graphics, JsonAsset, resources, Vec2 } from "cc";
const { ccclass, property } = _decorator;

/**
 * 高级汉字书写动画组件
 * 实现更真实的毛笔/钢笔书写效果
 */
@ccclass("WriteAdvanced")
export class WriteAdvanced extends Component {
	@property(Graphics)
	graphics: Graphics = null;
	@property(Graphics)
	base: Graphics = null;
	@property(Graphics)
	bg: Graphics = null;

	@property({ tooltip: "缩放比例" })
	scale: number = 0.5;

	@property({ tooltip: "自动居中显示" })
	autoCenter: boolean = true;

	@property({ tooltip: "每笔间隔时间（秒）" })
	strokeDelay: number = 0.5;

	@property({ tooltip: "是否自动播放" })
	autoPlay: boolean = true;

	@property({ tooltip: "笔画颜色" })
	strokeColor: Color = Color.WHITE;

	@property({ tooltip: "临摹原型颜色" })
	baseColor: Color = new Color(100, 100, 100, 80);

	@property({ tooltip: "显示临摹原型" })
	showBase: boolean = true;

	// ==================== 高级笔触参数 ====================

	@property({ tooltip: "最小笔触宽度（基准值）", range: [1, 50, 0.5] })
	minStrokeWidth: number = 20;

	@property({ tooltip: "最大笔触宽度（基准值）", range: [1, 50, 0.5] })
	maxStrokeWidth: number = 30;

	@property({ tooltip: "笔画宽度跟随缩放" })
	scaleStrokeWidth: boolean = true;

	// ==================== 速度控制 ====================

	@property({ tooltip: "笔触速度（像素/秒）", range: [50, 1000, 10] })
	strokeSpeed: number = 300;

	@property({ tooltip: "速度倍率（全局加速/减速）", range: [0.1, 5, 0.1] })
	speedMultiplier: number = 1.0;

	@property({ tooltip: "使用速度缓动（起笔慢、中间快、收笔慢）" })
	useSpeedEasing: boolean = true;

	@property({ tooltip: "起笔速度（相对于正常速度）", range: [0.1, 2, 0.1] })
	startSpeedRatio: number = 0.3; // 起笔时速度为30%

	@property({ tooltip: "收笔速度（相对于正常速度）", range: [0.1, 2, 0.1] })
	endSpeedRatio: number = 0.4; // 收笔时速度为40%

	// ==================== 点密度控制 ====================

	@property({ tooltip: "点采样密度（像素/点，越小越密）", range: [0.5, 20, 0.5] })
	pointDensity: number = 5;

	@property({ tooltip: "最小点间距（像素）", range: [0.5, 10, 0.5] })
	minPointDistance: number = 1;

	@property({ tooltip: "最大点间距（像素）", range: [5, 50, 1] })
	maxPointDistance: number = 12;

	@property({ tooltip: "根据速度调整点密度" })
	adaptivePointDensity: boolean = true;

	// ==================== 笔触效果 ====================

	@property({ tooltip: "起笔时长比例（0-1）", range: [0, 1, 0.05] })
	startStrokeRatio: number = 0.15; // 起笔阶段占15%

	@property({ tooltip: "收笔时长比例（0-1）", range: [0, 1, 0.05] })
	endStrokeRatio: number = 0.15; // 收笔阶段占15%

	@property({ tooltip: "使用变宽度笔触" })
	useVariableWidth: boolean = true;

	@property({ tooltip: "显示笔触轨迹点（调试用）" })
	showDebugPoints: boolean = false;

	@property({ tooltip: "显示 Median 关键点（调试用）" })
	showMedianPoints: boolean = false;

	// ==================== 私有变量 ====================

	// HanziWriter的标准viewBox大小
	private readonly SVG_SIZE: number = 1024;

	// 存储笔画的边界框
	private bounds: { minX: number; minY: number; maxX: number; maxY: number } = null;

	private charData: any = null;
	private currentStrokeIndex: number = 0;
	private elapsedTime: number = 0;
	private currentStrokeProgress: number = 0;
	private isAnimatingStroke: boolean = false;
	private currentStrokeDuration: number = 0;
	private currentMedians: number[][] = [];
	private strokePoints: Array<{ pos: Vec2; width: number }> = [];

	// 书写记录：保存每一笔的完整数据
	private strokeHistory: Array<{
		strokeIndex: number;
		points: Array<{ pos: Vec2; width: number }>;
		timestamp: number;
	}> = [];

	protected onLoad(): void {
		this.graphics.lineWidth = this.minStrokeWidth;
		this.graphics.strokeColor = this.strokeColor;
		this.graphics.fillColor = this.strokeColor;

		if (this.base) {
			this.base.fillColor = this.baseColor;
			this.base.strokeColor = this.baseColor;
		}
	}

	protected start() {
		this.drawGrid();
		// 加载汉字数据
		resources.load("hanzi-writer-data/我", JsonAsset, (err, asset: JsonAsset) => {
			if (err) {
				console.error("加载汉字数据失败:", err);
				return;
			}

			this.charData = asset.json;
			console.log("加载汉字数据成功:", this.charData);

			// 如果启用自动居中，计算边界框
			if (this.autoCenter) {
				this.calculateBounds();
			}

			// 绘制临摹原型
			if (this.base && this.showBase) {
				this.drawBaseCharacter();
			}

			if (this.autoPlay) {
				this.playAnimation();
			}
		});
	}

	/**
	 * 绘制临摹原型（完整的汉字轮廓）
	 */
	drawBaseCharacter() {
		if (!this.base || !this.charData) {
			return;
		}

		this.base.clear();
		this.base.fillColor = this.baseColor;

		// 绘制所有笔画
		for (const stroke of this.charData.strokes) {
			this.drawSVGPath(stroke, this.base);
		}
	}

	/**
	 * 解析并绘制 SVG 路径
	 */
	private drawSVGPath(pathData: string, graphics: Graphics) {
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

	/**
	 * 解析 SVG 路径字符串
	 */
	private parseSVGPath(pathData: string): Array<any> {
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
	 * 播放完整动画
	 */
	playAnimation() {
		this.restart();
	}

	/**
	 * 重新开始动画
	 */
	restart() {
		this.currentStrokeIndex = 0;
		this.elapsedTime = 0;
		this.isAnimatingStroke = false;
		this.strokeHistory = []; // 清空历史记录
		this.graphics.clear();
		this.drawNextStroke();
	}

	/** 清除所有书写记录 */
	clearHistory() {
		this.strokeHistory = [];
		this.graphics.clear();
	}

	/** 切换临摹原型显示 */
	toggleBase() {
		this.showBase = !this.showBase;
		if (this.base) {
			this.showBase ? this.drawBaseCharacter() : this.base.clear();
		}
	}

	/**
	 * 获取书写记录
	 */
	getHistory() {
		return this.strokeHistory;
	}

	/**
	 * 保存当前笔画到历史记录
	 */
	private saveCurrentStrokeToHistory() {
		if (this.strokePoints.length === 0) return;

		// 深拷贝当前笔画的点数据
		const pointsCopy = this.strokePoints.map((p) => ({
			pos: new Vec2(p.pos.x, p.pos.y),
			width: p.width,
		}));

		const record = {
			strokeIndex: this.currentStrokeIndex,
			points: pointsCopy,
			timestamp: Date.now(),
		};

		this.strokeHistory.push(record);
		this.strokePoints = [];
	}

	/** 打印历史记录摘要 */
	private printHistory() {
		console.log("\n📚 书写历史:", this.strokeHistory.map((r, i) => `笔画${r.strokeIndex + 1}: ${r.points.length}点`).join(", "));
	}

	/** 导出书写记录为 JSON */
	exportHistoryAsJSON(): string {
		return JSON.stringify(
			{
				character: this.charData?.character || "未知",
				totalStrokes: this.strokeHistory.length,
				records: this.strokeHistory.map((r) => ({
					strokeIndex: r.strokeIndex,
					pointCount: r.points.length,
					timestamp: r.timestamp,
					points: r.points.map((p) => ({
						x: Math.round(p.pos.x * 10) / 10,
						y: Math.round(p.pos.y * 10) / 10,
						w: Math.round(p.width * 10) / 10,
					})),
				})),
			},
			null,
			2
		);
	}

	/** 从 JSON 导入书写记录 */
	importHistoryFromJSON(json: string): boolean {
		try {
			const data = JSON.parse(json);
			this.strokeHistory = data.records.map((r: any) => ({
				strokeIndex: r.strokeIndex,
				timestamp: r.timestamp,
				points: r.points.map((p: any) => ({ pos: new Vec2(p.x, p.y), width: p.w })),
			}));
			this.graphics.clear();
			this.drawHistoryStrokes();
			return true;
		} catch (error) {
			console.error("导入失败:", error);
			return false;
		}
	}

	/**
	 * 回放书写历史（重新绘制）
	 */
	replayHistory() {
		console.log("🔄 开始回放书写历史...");
		this.graphics.clear();

		let index = 0;
		const replayInterval = 500; // 每500ms绘制一笔

		const drawNextHistoryStroke = () => {
			if (index >= this.strokeHistory.length) {
				console.log("✅ 回放完成！");
				return;
			}

			// 绘制从第一笔到当前笔
			this.graphics.clear();
			for (let i = 0; i <= index; i++) {
				const record = this.strokeHistory[i];
				// 使用平滑绘制方法
				this.drawSmoothStroke(record.points);
			}

			console.log(`🎬 回放进度: ${index + 1}/${this.strokeHistory.length}`);
			index++;

			this.scheduleOnce(drawNextHistoryStroke, replayInterval / 1000);
		};

		drawNextHistoryStroke();
	}

	/**
	 * 绘制下一笔
	 */
	drawNextStroke() {
		if (!this.charData || this.currentStrokeIndex >= this.charData.strokes.length) {
			return;
		}

		this.isAnimatingStroke = true;
		this.currentStrokeProgress = 0;
		this.strokePoints = [];

		// 获取当前笔画的 medians 数据
		this.currentMedians = this.charData.medians[this.currentStrokeIndex];

		// 计算笔画长度和时长（考虑速度倍率）
		const strokeLength = this.calculateMediansLength(this.currentMedians);
		const baseSpeed = this.strokeSpeed * this.speedMultiplier;

		// 如果使用速度缓动，需要计算平均速度
		if (this.useSpeedEasing) {
			// 计算加权平均速度
			const avgSpeedRatio =
				this.startSpeedRatio * this.startStrokeRatio +
				1.0 * (1 - this.startStrokeRatio - this.endStrokeRatio) +
				this.endSpeedRatio * this.endStrokeRatio;
			this.currentStrokeDuration = strokeLength / (baseSpeed * avgSpeedRatio);
		} else {
			this.currentStrokeDuration = strokeLength / baseSpeed;
		}

		console.log(
			`📝 笔画${this.currentStrokeIndex + 1}/${this.charData.strokes.length}: ${strokeLength.toFixed(0)}px ${baseSpeed.toFixed(
				0
			)}px/s ${this.currentStrokeDuration.toFixed(2)}s`
		);
	}

	/**
	 * 计算所有笔画的边界框
	 */
	private calculateBounds() {
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

	/** 计算当前进度对应的速度倍率 */
	getSpeedMultiplierAtProgress(progress: number): number {
		if (!this.useSpeedEasing) return 1.0;

		if (progress < this.startStrokeRatio) {
			const t = progress / this.startStrokeRatio;
			return this.startSpeedRatio + (1.0 - this.startSpeedRatio) * this.easeOutQuad(t);
		}
		if (progress > 1 - this.endStrokeRatio) {
			const t = (progress - (1 - this.endStrokeRatio)) / this.endStrokeRatio;
			return 1.0 - (1.0 - this.endSpeedRatio) * this.easeInQuad(t);
		}
		return 1.0;
	}

	/**
	 * 获取应用缩放后的最小笔触宽度
	 */
	private getScaledMinWidth(): number {
		return this.scaleStrokeWidth ? this.minStrokeWidth * this.scale : this.minStrokeWidth;
	}

	/** 计算当前进度对应的笔触宽度 */
	getStrokeWidthAtProgress(progress: number): number {
		let width = this.minStrokeWidth;

		if (this.useVariableWidth) {
			if (progress < this.startStrokeRatio) {
				const t = this.easeOutQuad(progress / this.startStrokeRatio);
				width = this.minStrokeWidth + (this.maxStrokeWidth - this.minStrokeWidth) * t;
			} else if (progress > 1 - this.endStrokeRatio) {
				const t = this.easeInQuad((progress - (1 - this.endStrokeRatio)) / this.endStrokeRatio);
				width = this.maxStrokeWidth - (this.maxStrokeWidth - this.minStrokeWidth) * t;
			} else {
				width = this.maxStrokeWidth + Math.sin(progress * Math.PI * 4) * 0.5;
			}
		}

		return this.scaleStrokeWidth ? width * this.scale : width;
	}

	/** 将SVG的X坐标转换为Cocos坐标系 */
	private transformX(x: number): number {
		const centerX = this.bounds && this.autoCenter ? (this.bounds.minX + this.bounds.maxX) / 2 : this.SVG_SIZE / 2;
		return (x - centerX) * this.scale;
	}

	/** 将SVG的Y坐标转换为Cocos坐标系 */
	private transformY(y: number): number {
		const centerY = this.bounds && this.autoCenter ? (this.bounds.minY + this.bounds.maxY) / 2 : this.SVG_SIZE / 2;
		return (y - centerY) * this.scale;
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

	/**
	 * 平滑绘制笔画（填充点之间的间隙）
	 */
	private drawSmoothStroke(points: Array<{ pos: Vec2; width: number }>) {
		if (points.length === 0) return;

		this.graphics.fillColor = this.strokeColor;

		// 绘制第一个点
		this.graphics.circle(points[0].pos.x, points[0].pos.y, points[0].width / 2);
		this.graphics.fill();

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

				this.graphics.circle(x, y, width / 2);
				this.graphics.fill();
			}
		}
	}

	/**
	 * 绘制变宽度笔触（包含历史记录）
	 */
	drawVariableWidthStroke() {
		// 清空画布
		this.graphics.clear();

		// 先绘制所有历史笔画（已完成的笔画）
		this.drawHistoryStrokes();

		// 再绘制当前正在进行的笔画
		if (this.strokePoints.length < 1) return;

		// 绘制笔画点，并在相邻点之间插值填充间隙
		this.drawSmoothStroke(this.strokePoints);

		// 调试：显示轨迹点
		if (this.showDebugPoints) {
			this.strokePoints.forEach((point, i) => {
				this.graphics.fillColor = i === 0 ? Color.GREEN : i === this.strokePoints.length - 1 ? Color.RED : Color.YELLOW;
				this.graphics.circle(point.pos.x, point.pos.y, 3);
				this.graphics.fill();
			});
		}

		// 调试：显示 Median 关键点（蓝色）
		if (this.showMedianPoints && this.currentMedians) {
			for (const median of this.currentMedians) {
				const x = this.transformX(median[0]);
				const y = this.transformY(median[1]);
				this.graphics.fillColor = Color.BLUE;
				this.graphics.circle(x, y, 4);
				this.graphics.fill();
			}
		}
	}

	/**
	 * 绘制历史记录中的所有笔画
	 */
	drawHistoryStrokes() {
		for (const record of this.strokeHistory) {
			// 使用平滑绘制方法
			this.drawSmoothStroke(record.points);
		}
	}

	/**
	 * 绘制田字格
	 */
	drawGrid() {
		if (!this.bg) {
			console.warn("⚠️ bg Graphics 节点未绑定！");
			return;
		}

		this.bg.clear();
		this.bg.lineWidth = 2;

		// 计算田字格的大小
		let gridSize: number;

		if (this.bounds && this.autoCenter) {
			// 根据实际汉字边界框大小来确定田字格大小
			const width = this.bounds.maxX - this.bounds.minX;
			const height = this.bounds.maxY - this.bounds.minY;
			gridSize = Math.max(width, height) * this.scale * 1.2; // 留出20%的边距
		} else {
			// 使用标准 SVG 画布大小
			gridSize = this.SVG_SIZE * this.scale;
		}

		const halfSize = gridSize / 2;

		this.bg.rect(-halfSize, -halfSize, gridSize, gridSize);
		// 绘制对角线
		this.bg.moveTo(-halfSize, -halfSize);
		this.bg.lineTo(halfSize, halfSize);
		this.bg.moveTo(-halfSize, halfSize);
		this.bg.lineTo(halfSize, -halfSize);

		this.bg.stroke();
	}

	/**
	 * Update 循环
	 */
	protected update(deltaTime: number): void {
		if (!this.isAnimatingStroke || !this.charData) {
			return;
		}

		// 更新动画进度
		this.currentStrokeProgress += deltaTime / this.currentStrokeDuration;

		if (this.currentStrokeProgress >= 1.0) {
			// 当前笔画完成
			this.currentStrokeProgress = 1.0;
			this.isAnimatingStroke = false;

			// 添加最后一个点
			const finalPoint = this.getPointAtProgress(this.currentMedians, 1.0);
			const finalWidth = this.getStrokeWidthAtProgress(1.0);
			this.strokePoints.push({ pos: finalPoint, width: finalWidth });

			// 💾 保存当前笔画到历史记录
			this.saveCurrentStrokeToHistory();

			// 绘制一次以显示完整的笔画（包括历史）
			this.drawVariableWidthStroke();

			// 准备下一笔
			this.elapsedTime = 0;
			this.currentStrokeIndex++;

			// 延迟后绘制下一笔
			this.scheduleOnce(() => {
				if (this.currentStrokeIndex < this.charData.strokes.length) {
					this.drawNextStroke();
				} else {
					console.log(`✅ 所有笔画完成！共 ${this.strokeHistory.length} 笔`);
					this.printHistory();
				}
			}, this.strokeDelay);
		} else {
			// 动画进行中：添加新的笔触点
			const point = this.getPointAtProgress(this.currentMedians, this.currentStrokeProgress);
			const width = this.getStrokeWidthAtProgress(this.currentStrokeProgress);

			// 计算当前应该的点间距
			let targetDistance = this.pointDensity;

			// 自适应点密度：根据速度调整
			if (this.adaptivePointDensity) {
				const speedRatio = this.getSpeedMultiplierAtProgress(this.currentStrokeProgress);
				// 速度快时点距大，速度慢时点距小
				targetDistance = this.pointDensity * speedRatio;
				// 限制在最小和最大间距之间
				targetDistance = Math.max(this.minPointDistance, Math.min(this.maxPointDistance, targetDistance));
			}

			// 使用更小的最小距离来避免刚添加关键点后又添加太近的普通点造成错位
			const minAllowedDistance = Math.max(targetDistance, this.getScaledMinWidth() * 0.3);
			const shouldAddPoint =
				this.strokePoints.length === 0 || Vec2.distance(point, this.strokePoints[this.strokePoints.length - 1].pos) >= minAllowedDistance;

			if (shouldAddPoint) {
				this.strokePoints.push({ pos: point, width });
			}

			this.drawVariableWidthStroke();
		}
	}

	// ==================== 缓动函数 ====================
	easeOutQuad(t: number): number {
		return t * (2 - t);
	}
	easeInQuad(t: number): number {
		return t * t;
	}
	easeCos(t: number): number {
		return -Math.cos(t * Math.PI) / 2 + 0.5;
	}

	// ==================== 调试和预设 ====================

	/** 打印当前配置信息 */
	printConfig() {
		console.log(`⚙️ 配置: 缩放${this.scale} 笔触${this.minStrokeWidth}~${this.maxStrokeWidth} 速度${this.strokeSpeed}px/s 点密度${this.pointDensity}`);
	}

	/**
	 * 应用预设配置
	 */
	applyPreset(presetName: string) {
		const presets: Record<string, Partial<WriteAdvanced>> = {
			fast: { strokeSpeed: 500, speedMultiplier: 1.5, pointDensity: 12, useSpeedEasing: false },
			slow: { strokeSpeed: 150, speedMultiplier: 0.8, pointDensity: 4, useSpeedEasing: true },
			detailed: { pointDensity: 3, minPointDistance: 1, maxPointDistance: 8, adaptivePointDensity: true },
			smooth: { pointDensity: 10, minPointDistance: 5, maxPointDistance: 20, adaptivePointDensity: false },
			calligraphy: {
				minStrokeWidth: 3,
				maxStrokeWidth: 12,
				useVariableWidth: true,
				startStrokeRatio: 0.2,
				endStrokeRatio: 0.25,
				startSpeedRatio: 0.2,
				endSpeedRatio: 0.3,
				useSpeedEasing: true,
			},
			marker: { minStrokeWidth: 5, maxStrokeWidth: 6, useVariableWidth: false, strokeSpeed: 400, useSpeedEasing: false },
		};

		if (presets[presetName]) {
			Object.assign(this, presets[presetName]);
			this.printConfig();
		}
	}

	/** 计算预估的总时长和点数 */
	estimatePerformance() {
		if (!this.charData) return;

		let totalLength = 0,
			totalPoints = 0;
		this.charData.medians.forEach((m: number[][]) => {
			const len = this.calculateMediansLength(m);
			totalLength += len;
			totalPoints += Math.ceil(len / this.pointDensity);
		});

		const baseSpeed = this.strokeSpeed * this.speedMultiplier;
		const avgSpeedRatio = this.useSpeedEasing
			? this.startSpeedRatio * this.startStrokeRatio + 1.0 * (1 - this.startStrokeRatio - this.endStrokeRatio) + this.endSpeedRatio * this.endStrokeRatio
			: 1.0;
		const totalDuration = totalLength / (baseSpeed * avgSpeedRatio);
		const totalWithDelay = totalDuration + this.strokeDelay * (this.charData.strokes.length - 1);

		console.log(`📊 ${this.charData.strokes.length}笔 ${totalPoints}点 ${totalDuration.toFixed(1)}s (含间隔${totalWithDelay.toFixed(1)}s)`);
	}
}
