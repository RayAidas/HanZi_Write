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

	@property({ tooltip: "最小笔触宽度", range: [1, 20, 0.5] })
	minStrokeWidth: number = 2;

	@property({ tooltip: "最大笔触宽度", range: [1, 30, 0.5] })
	maxStrokeWidth: number = 8;

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

		console.log("📝 已绘制临摹原型");
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

	/**
	 * 清除所有书写记录
	 */
	clearHistory() {
		this.strokeHistory = [];
		this.graphics.clear();
		console.log("✨ 已清除所有书写记录");
	}

	/**
	 * 切换临摹原型显示
	 */
	toggleBase() {
		this.showBase = !this.showBase;
		if (this.base) {
			if (this.showBase) {
				this.drawBaseCharacter();
			} else {
				this.base.clear();
			}
		}
		console.log(`👁️ 临摹原型: ${this.showBase ? "显示" : "隐藏"}`);
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

		console.log(`📝 第 ${this.currentStrokeIndex + 1} 笔已保存，共 ${pointsCopy.length} 个点`);

		// 清空当前笔画点（准备绘制下一笔）
		this.strokePoints = [];
	}

	/**
	 * 打印历史记录摘要
	 */
	private printHistory() {
		console.log("\n📚 ===== 书写历史记录 =====");
		this.strokeHistory.forEach((record, index) => {
			const duration = index > 0 ? ((record.timestamp - this.strokeHistory[index - 1].timestamp) / 1000).toFixed(2) : "0.00";
			console.log(
				`笔画 ${record.strokeIndex + 1}: ${record.points.length} 点, ` +
					`耗时 ${duration}s, ` +
					`时间戳 ${new Date(record.timestamp).toLocaleTimeString()}`
			);
		});
		console.log("========================\n");
	}

	/**
	 * 导出书写记录为 JSON
	 */
	exportHistoryAsJSON(): string {
		const exportData = {
			character: this.charData?.character || "未知",
			totalStrokes: this.strokeHistory.length,
			records: this.strokeHistory.map((record) => ({
				strokeIndex: record.strokeIndex,
				pointCount: record.points.length,
				timestamp: record.timestamp,
				// 为了减少数据量，只保存关键点
				points: record.points.map((p) => ({
					x: Math.round(p.pos.x * 10) / 10,
					y: Math.round(p.pos.y * 10) / 10,
					w: Math.round(p.width * 10) / 10,
				})),
			})),
		};

		const json = JSON.stringify(exportData, null, 2);
		console.log("📤 导出书写记录:", json);
		return json;
	}

	/**
	 * 从 JSON 导入书写记录
	 */
	importHistoryFromJSON(json: string): boolean {
		try {
			const data = JSON.parse(json);

			this.strokeHistory = data.records.map((record: any) => ({
				strokeIndex: record.strokeIndex,
				timestamp: record.timestamp,
				points: record.points.map((p: any) => ({
					pos: new Vec2(p.x, p.y),
					width: p.w,
				})),
			}));

			// 重新绘制
			this.graphics.clear();
			this.drawHistoryStrokes();

			console.log(`📥 成功导入 ${this.strokeHistory.length} 笔书写记录`);
			return true;
		} catch (error) {
			console.error("❌ 导入失败:", error);
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

				// 绘制圆形
				for (const point of record.points) {
					this.graphics.fillColor = this.strokeColor;
					this.graphics.circle(point.pos.x, point.pos.y, point.width / 2);
					this.graphics.fill();
				}

				// 绘制连接线
				if (record.points.length > 1) {
					this.graphics.lineWidth = this.minStrokeWidth;
					this.graphics.strokeColor = this.strokeColor;
					this.graphics.moveTo(record.points[0].pos.x, record.points[0].pos.y);
					for (let j = 1; j < record.points.length; j++) {
						this.graphics.lineTo(record.points[j].pos.x, record.points[j].pos.y);
					}
					this.graphics.stroke();
				}
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
			`📝 笔画 ${this.currentStrokeIndex + 1}/${this.charData.strokes.length}:`,
			`长度=${strokeLength.toFixed(1)}px`,
			`速度=${baseSpeed.toFixed(0)}px/s`,
			`时长=${this.currentStrokeDuration.toFixed(2)}s`,
			`点密度=${this.pointDensity.toFixed(1)}px/点`
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
		console.log("📐 边界框:", this.bounds);
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
	 * 计算当前进度对应的速度倍率（速度缓动）
	 */
	getSpeedMultiplierAtProgress(progress: number): number {
		if (!this.useSpeedEasing) {
			return 1.0;
		}

		const { startStrokeRatio, endStrokeRatio, startSpeedRatio, endSpeedRatio } = this;

		// 起笔阶段：慢速
		if (progress < startStrokeRatio) {
			const t = progress / startStrokeRatio;
			// 从 startSpeedRatio 渐变到 1.0
			return startSpeedRatio + (1.0 - startSpeedRatio) * this.easeOutQuad(t);
		}

		// 收笔阶段：减速
		if (progress > 1 - endStrokeRatio) {
			const t = (progress - (1 - endStrokeRatio)) / endStrokeRatio;
			// 从 1.0 渐变到 endSpeedRatio
			return 1.0 - (1.0 - endSpeedRatio) * this.easeInQuad(t);
		}

		// 行笔阶段：正常速度
		return 1.0;
	}

	/**
	 * 计算当前进度对应的笔触宽度（模拟笔压）
	 */
	getStrokeWidthAtProgress(progress: number): number {
		if (!this.useVariableWidth) {
			return this.minStrokeWidth;
		}

		const { startStrokeRatio, endStrokeRatio, minStrokeWidth, maxStrokeWidth } = this;

		// 起笔阶段：从最小宽度渐增到最大宽度
		if (progress < startStrokeRatio) {
			const t = progress / startStrokeRatio;
			const eased = this.easeOutQuad(t);
			return minStrokeWidth + (maxStrokeWidth - minStrokeWidth) * eased;
		}

		// 收笔阶段：从最大宽度渐减到最小宽度
		if (progress > 1 - endStrokeRatio) {
			const t = (progress - (1 - endStrokeRatio)) / endStrokeRatio;
			const eased = this.easeInQuad(t);
			return maxStrokeWidth - (maxStrokeWidth - minStrokeWidth) * eased;
		}

		// 行笔阶段：保持最大宽度，加入轻微波动
		const wobble = Math.sin(progress * Math.PI * 4) * 0.5; // 轻微抖动
		return maxStrokeWidth + wobble;
	}

	/**
	 * 将SVG的X坐标转换为Cocos坐标系
	 */
	private transformX(x: number): number {
		let centerX: number;

		if (this.bounds && this.autoCenter) {
			// 使用实际笔画边界框的中心
			centerX = (this.bounds.minX + this.bounds.maxX) / 2;
		} else {
			// 使用SVG画布的中心
			centerX = this.SVG_SIZE / 2;
		}

		return (x - centerX) * this.scale;
	}

	/**
	 * 将SVG的Y坐标转换为Cocos坐标系
	 */
	private transformY(y: number): number {
		let centerY: number;

		if (this.bounds && this.autoCenter) {
			// 使用实际笔画边界框的中心
			centerY = (this.bounds.minY + this.bounds.maxY) / 2;
		} else {
			// 使用SVG画布的中心
			centerY = this.SVG_SIZE / 2;
		}

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
	 * 绘制变宽度笔触（包含历史记录）
	 */
	drawVariableWidthStroke() {
		// 清空画布
		this.graphics.clear();

		// 先绘制所有历史笔画（已完成的笔画）
		this.drawHistoryStrokes();

		// 再绘制当前正在进行的笔画
		if (this.strokePoints.length < 2) return;

		// 方法1: 使用多个圆形填充（适合变宽度）
		for (let i = 0; i < this.strokePoints.length; i++) {
			const point = this.strokePoints[i];
			this.graphics.fillColor = this.strokeColor;
			this.graphics.circle(point.pos.x, point.pos.y, point.width / 2);
			this.graphics.fill();
		}

		// 方法2: 绘制连接线（可选）
		if (this.strokePoints.length > 1) {
			this.graphics.lineWidth = this.minStrokeWidth;
			this.graphics.strokeColor = this.strokeColor;
			this.graphics.moveTo(this.strokePoints[0].pos.x, this.strokePoints[0].pos.y);
			for (let i = 1; i < this.strokePoints.length; i++) {
				this.graphics.lineTo(this.strokePoints[i].pos.x, this.strokePoints[i].pos.y);
			}
			this.graphics.stroke();
		}

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
			// 绘制每一笔的圆形
			for (const point of record.points) {
				this.graphics.fillColor = this.strokeColor;
				this.graphics.circle(point.pos.x, point.pos.y, point.width / 2);
				this.graphics.fill();
			}

			// 绘制连接线
			if (record.points.length > 1) {
				this.graphics.lineWidth = this.minStrokeWidth;
				this.graphics.strokeColor = this.strokeColor;
				this.graphics.moveTo(record.points[0].pos.x, record.points[0].pos.y);
				for (let i = 1; i < record.points.length; i++) {
					this.graphics.lineTo(record.points[i].pos.x, record.points[i].pos.y);
				}
				this.graphics.stroke();
			}
		}
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

			// 判断是否应该添加新点
			const shouldAddPoint =
				this.strokePoints.length === 0 || Vec2.distance(point, this.strokePoints[this.strokePoints.length - 1].pos) >= targetDistance;

			if (shouldAddPoint) {
				this.strokePoints.push({ pos: point, width });
			}

			this.drawVariableWidthStroke();
		}
	}

	// ==================== 缓动函数 ====================

	/**
	 * 二次缓出：加速
	 */
	easeOutQuad(t: number): number {
		return t * (2 - t);
	}

	/**
	 * 二次缓入：减速
	 */
	easeInQuad(t: number): number {
		return t * t;
	}

	/**
	 * Cos 缓动（hanzi-writer 使用）
	 */
	easeCos(t: number): number {
		return -Math.cos(t * Math.PI) / 2 + 0.5;
	}

	// ==================== 调试和预设 ====================

	/**
	 * 打印当前配置信息
	 */
	printConfig() {
		console.log("\n⚙️ ===== 当前配置 =====");
		console.log("📏 尺寸参数:");
		console.log(`  - 缩放: ${this.scale}`);
		console.log(`  - 自动居中: ${this.autoCenter ? "启用" : "禁用"}`);
		console.log(`  - 临摹原型: ${this.showBase ? "显示" : "隐藏"}`);
		console.log(`  - 笔触宽度: ${this.minStrokeWidth} ~ ${this.maxStrokeWidth}px`);

		console.log("\n🏃 速度参数:");
		console.log(`  - 基础速度: ${this.strokeSpeed}px/s`);
		console.log(`  - 速度倍率: ${this.speedMultiplier}x`);
		console.log(`  - 实际速度: ${(this.strokeSpeed * this.speedMultiplier).toFixed(0)}px/s`);
		console.log(`  - 速度缓动: ${this.useSpeedEasing ? "启用" : "禁用"}`);
		if (this.useSpeedEasing) {
			console.log(`    * 起笔速度: ${(this.startSpeedRatio * 100).toFixed(0)}%`);
			console.log(`    * 收笔速度: ${(this.endSpeedRatio * 100).toFixed(0)}%`);
		}

		console.log("\n🎯 点密度参数:");
		console.log(`  - 基础点密度: ${this.pointDensity}px/点`);
		console.log(`  - 点间距范围: ${this.minPointDistance} ~ ${this.maxPointDistance}px`);
		console.log(`  - 自适应密度: ${this.adaptivePointDensity ? "启用" : "禁用"}`);

		console.log("\n✨ 笔触效果:");
		console.log(`  - 变宽度笔触: ${this.useVariableWidth ? "启用" : "禁用"}`);
		console.log(`  - 起笔阶段: ${(this.startStrokeRatio * 100).toFixed(0)}%`);
		console.log(`  - 收笔阶段: ${(this.endStrokeRatio * 100).toFixed(0)}%`);
		console.log("======================\n");
	}

	/**
	 * 应用预设配置
	 */
	applyPreset(presetName: string) {
		switch (presetName) {
			case "fast": // 快速书写
				this.strokeSpeed = 500;
				this.speedMultiplier = 1.5;
				this.pointDensity = 12;
				this.useSpeedEasing = false;
				console.log("✅ 已应用预设: 快速书写");
				break;

			case "slow": // 慢速书写
				this.strokeSpeed = 150;
				this.speedMultiplier = 0.8;
				this.pointDensity = 4;
				this.useSpeedEasing = true;
				console.log("✅ 已应用预设: 慢速书写");
				break;

			case "detailed": // 高细节
				this.pointDensity = 3;
				this.minPointDistance = 1;
				this.maxPointDistance = 8;
				this.adaptivePointDensity = true;
				console.log("✅ 已应用预设: 高细节");
				break;

			case "smooth": // 流畅
				this.pointDensity = 10;
				this.minPointDistance = 5;
				this.maxPointDistance = 20;
				this.adaptivePointDensity = false;
				console.log("✅ 已应用预设: 流畅");
				break;

			case "calligraphy": // 书法风格
				this.minStrokeWidth = 3;
				this.maxStrokeWidth = 12;
				this.useVariableWidth = true;
				this.startStrokeRatio = 0.2;
				this.endStrokeRatio = 0.25;
				this.startSpeedRatio = 0.2;
				this.endSpeedRatio = 0.3;
				this.useSpeedEasing = true;
				console.log("✅ 已应用预设: 书法风格");
				break;

			case "marker": // 马克笔风格
				this.minStrokeWidth = 5;
				this.maxStrokeWidth = 6;
				this.useVariableWidth = false;
				this.strokeSpeed = 400;
				this.useSpeedEasing = false;
				console.log("✅ 已应用预设: 马克笔风格");
				break;

			default:
				console.warn(`⚠️ 未知预设: ${presetName}`);
				console.log("可用预设: fast, slow, detailed, smooth, calligraphy, marker");
		}

		this.printConfig();
	}

	/**
	 * 计算预估的总时长和点数
	 */
	estimatePerformance() {
		if (!this.charData) {
			console.warn("⚠️ 尚未加载汉字数据");
			return;
		}

		let totalLength = 0;
		let totalPoints = 0;

		for (let i = 0; i < this.charData.strokes.length; i++) {
			const medians = this.charData.medians[i];
			const strokeLength = this.calculateMediansLength(medians);
			totalLength += strokeLength;

			// 估算点数
			const estimatedPoints = Math.ceil(strokeLength / this.pointDensity);
			totalPoints += estimatedPoints;
		}

		const baseSpeed = this.strokeSpeed * this.speedMultiplier;
		const avgSpeedRatio = this.useSpeedEasing
			? this.startSpeedRatio * this.startStrokeRatio + 1.0 * (1 - this.startStrokeRatio - this.endStrokeRatio) + this.endSpeedRatio * this.endStrokeRatio
			: 1.0;

		const totalDuration = totalLength / (baseSpeed * avgSpeedRatio);
		const totalWithDelay = totalDuration + this.strokeDelay * (this.charData.strokes.length - 1);

		console.log("\n📊 ===== 性能预估 =====");
		console.log(`总笔画数: ${this.charData.strokes.length} 笔`);
		console.log(`总路径长度: ${totalLength.toFixed(0)} px`);
		console.log(`预计总点数: ${totalPoints} 点`);
		console.log(`书写时长: ${totalDuration.toFixed(2)} 秒`);
		console.log(`含间隔时长: ${totalWithDelay.toFixed(2)} 秒`);
		console.log(`平均点数/笔: ${(totalPoints / this.charData.strokes.length).toFixed(0)} 点`);
		console.log("====================\n");
	}
}
