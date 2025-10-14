import { Vec2 } from "cc";

// ==================== 几何工具函数 ====================
export class GeometryUtils {
	static subtract(p1: Vec2, p2: Vec2): Vec2 {
		return new Vec2(p1.x - p2.x, p1.y - p2.y);
	}

	static magnitude(point: Vec2): number {
		return Math.sqrt(point.x * point.x + point.y * point.y);
	}

	static distance(p1: Vec2, p2: Vec2): number {
		return this.magnitude(this.subtract(p1, p2));
	}

	static pathLength(points: Vec2[]): number {
		let total = 0;
		for (let i = 1; i < points.length; i++) {
			total += this.distance(points[i], points[i - 1]);
		}
		return total;
	}

	static cosineSimilarity(v1: Vec2, v2: Vec2): number {
		const dotProduct = v1.x * v2.x + v1.y * v2.y;
		return dotProduct / this.magnitude(v1) / this.magnitude(v2);
	}

	static average(values: number[]): number {
		return values.reduce((a, b) => a + b, 0) / values.length;
	}

	/** Frechet 距离算法 */
	static frechetDist(curve1: Vec2[], curve2: Vec2[]): number {
		const long = curve1.length >= curve2.length ? curve1 : curve2;
		const short = curve1.length >= curve2.length ? curve2 : curve1;

		let prevCol: number[] = [];
		for (let i = 0; i < long.length; i++) {
			const curCol: number[] = [];
			for (let j = 0; j < short.length; j++) {
				let val: number;
				if (i === 0 && j === 0) {
					val = this.distance(long[0], short[0]);
				} else if (i > 0 && j === 0) {
					val = Math.max(prevCol[0], this.distance(long[i], short[0]));
				} else if (i === 0 && j > 0) {
					val = Math.max(curCol[j - 1], this.distance(long[0], short[j]));
				} else {
					val = Math.max(Math.min(prevCol[j], prevCol[j - 1], curCol[j - 1]), this.distance(long[i], short[j]));
				}
				curCol.push(val);
			}
			prevCol = curCol;
		}
		return prevCol[short.length - 1];
	}

	/** 归一化曲线 - 将曲线缩放到标准大小 */
	static normalizeCurve(points: Vec2[]): Vec2[] {
		if (points.length < 2) return points;

		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		points.forEach((p) => {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		});

		const width = maxX - minX || 1;
		const height = maxY - minY || 1;
		const scale = Math.max(width, height);
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		return points.map((p) => new Vec2((p.x - centerX) / scale, (p.y - centerY) / scale));
	}

	/** 旋转点 */
	static rotate(points: Vec2[], angle: number): Vec2[] {
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		return points.map((p) => new Vec2(p.x * cos - p.y * sin, p.x * sin + p.y * cos));
	}
}

// ==================== 笔画匹配算法 ====================
export interface StrokeMatchResult {
	isMatch: boolean;
	avgDistance: number;
}

export class StrokeMatcher {
	private static readonly COSINE_SIMILARITY_THRESHOLD = 0;
	private static readonly START_AND_END_DIST_THRESHOLD = 250;
	private static readonly FRECHET_THRESHOLD = 0.5;
	private static readonly MIN_LEN_THRESHOLD = 0.35;
	private static readonly SHAPE_FIT_ROTATIONS = [Math.PI / 16, Math.PI / 32, 0, -Math.PI / 32, -Math.PI / 16];

	/** 去除重复点 */
	private static stripDuplicates(points: Vec2[]): Vec2[] {
		if (points.length < 2) return points;
		const result = [points[0]];
		for (let i = 1; i < points.length; i++) {
			const last = result[result.length - 1];
			if (points[i].x !== last.x || points[i].y !== last.y) {
				result.push(points[i]);
			}
		}
		return result;
	}

	/** 获取边向量 */
	private static getEdgeVectors(points: Vec2[]): Vec2[] {
		const vectors: Vec2[] = [];
		for (let i = 1; i < points.length; i++) {
			vectors.push(GeometryUtils.subtract(points[i], points[i - 1]));
		}
		return vectors;
	}

	/** 检查起点和终点是否匹配 */
	private static startAndEndMatches(
		userPoints: Vec2[],
		strokePoints: Vec2[],
		leniency: number,
		debug: boolean = false,
		startEndThreshold: number = 250
	): boolean {
		const startDist = GeometryUtils.distance(strokePoints[0], userPoints[0]);
		const endDist = GeometryUtils.distance(strokePoints[strokePoints.length - 1], userPoints[userPoints.length - 1]);
		const threshold = startEndThreshold * leniency;
		const passes = startDist <= threshold && endDist <= threshold;

		return passes;
	}

	/** 检查方向是否匹配 */
	private static directionMatches(userPoints: Vec2[], strokePoints: Vec2[], debug: boolean = false): boolean {
		const userVectors = this.getEdgeVectors(userPoints);
		const strokeVectors = this.getEdgeVectors(strokePoints);

		const similarities = userVectors.map((userVec) => {
			const strokeSims = strokeVectors.map((strokeVec) => GeometryUtils.cosineSimilarity(strokeVec, userVec));
			return Math.max(...strokeSims);
		});

		const avgSimilarity = GeometryUtils.average(similarities);
		const passes = avgSimilarity > this.COSINE_SIMILARITY_THRESHOLD;
		return passes;
	}

	/** 检查长度是否匹配（使用区间范围）*/
	private static lengthMatches(
		userPoints: Vec2[],
		strokePoints: Vec2[],
		leniency: number,
		debug: boolean = false,
		minLengthRatio: number = 0.35,
		maxLengthRatio: number = 2.5
	): boolean {
		const userLen = GeometryUtils.pathLength(userPoints);
		const strokeLen = GeometryUtils.pathLength(strokePoints);
		const ratio = (leniency * (userLen + 25)) / (strokeLen + 25);
		const passes = ratio >= minLengthRatio && ratio <= maxLengthRatio;
		return passes;
	}

	/** 检查形状是否匹配（使用 Frechet 距离） */
	private static shapeFit(userPoints: Vec2[], strokePoints: Vec2[], leniency: number, debug: boolean = false, frechetThreshold: number = 0.5): boolean {
		const normUser = GeometryUtils.normalizeCurve(userPoints);
		const normStroke = GeometryUtils.normalizeCurve(strokePoints);

		let minDist = Infinity;
		for (const angle of this.SHAPE_FIT_ROTATIONS) {
			const rotated = GeometryUtils.rotate(normStroke, angle);
			const dist = GeometryUtils.frechetDist(normUser, rotated);
			if (dist < minDist) minDist = dist;
		}

		const threshold = frechetThreshold * leniency;
		const passes = minDist <= threshold;
		return passes;
	}

	/** 计算平均距离 */
	private static getAverageDistance(userPoints: Vec2[], strokePoints: Vec2[]): number {
		let totalDist = 0;
		for (const userPt of userPoints) {
			let minDist = Infinity;
			for (const strokePt of strokePoints) {
				const dist = GeometryUtils.distance(userPt, strokePt);
				if (dist < minDist) minDist = dist;
			}
			totalDist += minDist;
		}
		return totalDist / userPoints.length;
	}

	/** 主匹配函数 */
	static matchStroke(
		userPoints: Vec2[],
		strokePoints: Vec2[],
		leniency: number = 1,
		averageDistanceThreshold: number = 350,
		allStrokePoints?: Vec2[][], // 所有笔画点（用于检测顺序错误）
		currentStrokeIndex: number = 0,
		hasDrawnStrokes: boolean = false, // 是否已经画过笔画
		customThresholds?: {
			// 自定义阈值
			startEndThreshold?: number;
			frechetThreshold?: number;
			minLengthRatio?: number;
			maxLengthRatio?: number;
		}
	): StrokeMatchResult {
		const cleanPoints = this.stripDuplicates(userPoints);

		if (cleanPoints.length < 2) {
			return { isMatch: false, avgDistance: Infinity };
		}

		// 根据是否已有笔画调整阈值（更严格）
		const distMod = hasDrawnStrokes ? 0.5 : 1;
		const adjustedThreshold = averageDistanceThreshold * distMod;

		// 检查当前笔画匹配（启用详细调试）
		const currentMatch = this.testMatch(cleanPoints, strokePoints, leniency, adjustedThreshold, true, customThresholds);

		if (!currentMatch.isMatch) {
			return currentMatch;
		}

		// 防止笔画顺序错误：检查是否与后续笔画更匹配
		if (allStrokePoints && currentStrokeIndex < allStrokePoints.length - 1) {
			const laterStrokes = allStrokePoints.slice(currentStrokeIndex + 1);
			let closestMatchDist = currentMatch.avgDistance;
			let foundBetterMatch = false;
			let betterStrokeIndex = -1;

			for (let i = 0; i < laterStrokes.length; i++) {
				const laterMatch = this.testMatch(cleanPoints, laterStrokes[i], leniency, adjustedThreshold, false, customThresholds);
				if (laterMatch.isMatch && laterMatch.avgDistance < closestMatchDist) {
					closestMatchDist = laterMatch.avgDistance;
					foundBetterMatch = true;
					betterStrokeIndex = currentStrokeIndex + 1 + i;
				}
			}

			// 如果找到更好的匹配，动态降低宽松度重新验证
			if (foundBetterMatch) {
				const leniencyAdjustment = (0.6 * (closestMatchDist + currentMatch.avgDistance)) / (2 * currentMatch.avgDistance);
				const stricterMatch = this.testMatch(cleanPoints, strokePoints, leniency * leniencyAdjustment, adjustedThreshold, false, customThresholds);
				return stricterMatch;
			}
		}

		return currentMatch;
	}

	private static testMatch(
		userPoints: Vec2[],
		strokePoints: Vec2[],
		leniency: number,
		averageDistanceThreshold: number,
		debug: boolean = false,
		customThresholds?: {
			startEndThreshold?: number;
			frechetThreshold?: number;
			minLengthRatio?: number;
			maxLengthRatio?: number;
		}
	): { isMatch: boolean; avgDistance: number } {
		const avgDist = this.getAverageDistance(userPoints, strokePoints);

		if (avgDist > averageDistanceThreshold * leniency) {
			return { isMatch: false, avgDistance: avgDist };
		}

		// 使用自定义阈值或默认值
		const startEndThreshold = customThresholds?.startEndThreshold ?? this.START_AND_END_DIST_THRESHOLD;
		const frechetThreshold = customThresholds?.frechetThreshold ?? this.FRECHET_THRESHOLD;
		const minLengthRatio = customThresholds?.minLengthRatio ?? this.MIN_LEN_THRESHOLD;
		const maxLengthRatio = customThresholds?.maxLengthRatio ?? 2.5;

		const startEndMatch = this.startAndEndMatches(userPoints, strokePoints, leniency, debug, startEndThreshold);
		const dirMatch = this.directionMatches(userPoints, strokePoints, debug);
		const shapeMatch = this.shapeFit(userPoints, strokePoints, leniency, debug, frechetThreshold);
		const lenMatch = this.lengthMatches(userPoints, strokePoints, leniency, debug, minLengthRatio, maxLengthRatio);

		const isMatch = startEndMatch && dirMatch && shapeMatch && lenMatch;
		return { isMatch, avgDistance: avgDist };
	}
}

// ==================== 缓动函数 ====================
export function easeOutQuad(t: number): number {
	return t * (2 - t);
}
export function easeInQuad(t: number): number {
	return t * t;
}
export function easeCos(t: number): number {
	return -Math.cos(t * Math.PI) / 2 + 0.5;
}
