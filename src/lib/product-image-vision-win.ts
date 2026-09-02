/**
 * Windows/Linux 로컬 대체 — 모델컷/제품컷 판별용 Apple Vision 클라이언트의 CV 등가물.
 * `product-image-vision-client.ts` 헤더 참조. macOS 없이 이미지당 로컬에서:
 *   - 사람+포즈: onnxruntime-node + YOLOv8n-pose (Xenova ONNX export)
 *   - 텍스트 커버리지: tesseract.js OCR word bbox 합
 *   - 전경(사람 없는 제품컷용): 배경색 대비 픽셀 편차 기반 bbox 휴리스틱
 *   - aestheticsScore/isUtility: Apple 독점 미학 모델 대체 불가 — 라플라시안
 *     분산(샤프니스) 기반 근사치. 정확한 대응이 아니라 근사임을 명시.
 * IMAGE_SELECTION_VERSION 이 플랫폼별로 갈라지므로(win-cv-v1) mac 결과와 캐시가
 * 섞이지 않는다.
 */
import * as ort from "onnxruntime-node"
import sharp from "sharp"
import {createScheduler, createWorker, type Scheduler} from "tesseract.js"

const OCR_WORKER_POOL_SIZE = 4

import type {ImageCandidateAnalysis} from "./product-image-selection"

const MODEL_PATH = new URL("../../tools/product-image-vision/models/yolov8n-pose.onnx", import.meta.url)
const MODEL_INPUT_SIZE = 640
const CONF_THRESHOLD = 0.4
const IOU_THRESHOLD = 0.5
const NUM_KEYPOINTS = 17
const KEYPOINT_CONF_THRESHOLD = 0.3

interface Detection {
  confidence: number
  box: {x: number; y: number; width: number; height: number}
  keypointConfCount: number
}

interface Preprocessed {
  tensor: ort.Tensor
  scale: number
  padX: number
  padY: number
  width: number
  height: number
}

function iou(a: Detection["box"], b: Detection["box"]): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const interX = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
  const interY = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
  const inter = interX * interY
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

function nms(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
  const kept: Detection[] = []
  for (const det of sorted) {
    if (kept.some((k) => iou(k.box, det.box) > IOU_THRESHOLD)) continue
    kept.push(det)
  }
  return kept
}

async function preprocess(imagePath: string): Promise<Preprocessed> {
  const image = sharp(imagePath, {failOn: "none"}).rotate()
  const metadata = await image.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width <= 0 || height <= 0) throw new Error("image_decode_failed")

  const scale = Math.min(MODEL_INPUT_SIZE / width, MODEL_INPUT_SIZE / height)
  const newW = Math.max(1, Math.round(width * scale))
  const newH = Math.max(1, Math.round(height * scale))
  const padX = Math.floor((MODEL_INPUT_SIZE - newW) / 2)
  const padY = Math.floor((MODEL_INPUT_SIZE - newH) / 2)

  const {data} = await image
    .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, {
      fit: "contain",
      background: {r: 114, g: 114, b: 114},
    })
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject: true})

  const pixelCount = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE
  const tensorData = new Float32Array(3 * pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    tensorData[i] = data[i * 3] / 255
    tensorData[pixelCount + i] = data[i * 3 + 1] / 255
    tensorData[2 * pixelCount + i] = data[i * 3 + 2] / 255
  }

  return {
    tensor: new ort.Tensor("float32", tensorData, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]),
    scale,
    padX,
    padY,
    width,
    height,
  }
}

function decode(output: Float32Array, pre: Preprocessed): Detection[] {
  const numAnchors = output.length / (5 + NUM_KEYPOINTS * 3)
  const detections: Detection[] = []
  for (let a = 0; a < numAnchors; a++) {
    const conf = output[4 * numAnchors + a]
    if (conf < CONF_THRESHOLD) continue
    const cx = output[0 * numAnchors + a]
    const cy = output[1 * numAnchors + a]
    const w = output[2 * numAnchors + a]
    const h = output[3 * numAnchors + a]

    let keypointConfCount = 0
    for (let k = 0; k < NUM_KEYPOINTS; k++) {
      const kconf = output[(5 + k * 3 + 2) * numAnchors + a]
      if (kconf >= KEYPOINT_CONF_THRESHOLD) keypointConfCount++
    }

    const x1 = (cx - w / 2 - pre.padX) / pre.scale
    const y1 = (cy - h / 2 - pre.padY) / pre.scale
    const boxW = w / pre.scale
    const boxH = h / pre.scale

    detections.push({
      confidence: conf,
      box: {
        x: Math.max(0, x1),
        y: Math.max(0, y1),
        width: Math.min(boxW, pre.width),
        height: Math.min(boxH, pre.height),
      },
      keypointConfCount,
    })
  }
  return nms(detections)
}

/** 배경색과의 픽셀 편차로 전경 bbox를 추정 — 사람이 없는 제품컷(플랫레이 등)용. */
async function estimateForeground(
  imagePath: string,
  origWidth: number,
  origHeight: number,
): Promise<{areaRatio: number; centerDistance: number}> {
  const SIZE = 160
  const {data} = await sharp(imagePath, {failOn: "none"})
    .rotate()
    .resize(SIZE, SIZE, {fit: "fill"})
    .removeAlpha()
    .raw()
    .toBuffer({resolveWithObject: true})

  const borderSamples: number[][] = []
  for (let x = 0; x < SIZE; x += 4) {
    borderSamples.push([data[(x) * 3], data[(x) * 3 + 1], data[(x) * 3 + 2]])
    const bottomIdx = ((SIZE - 1) * SIZE + x) * 3
    borderSamples.push([data[bottomIdx], data[bottomIdx + 1], data[bottomIdx + 2]])
  }
  for (let y = 0; y < SIZE; y += 4) {
    const leftIdx = (y * SIZE) * 3
    borderSamples.push([data[leftIdx], data[leftIdx + 1], data[leftIdx + 2]])
    const rightIdx = (y * SIZE + SIZE - 1) * 3
    borderSamples.push([data[rightIdx], data[rightIdx + 1], data[rightIdx + 2]])
  }
  const bg = borderSamples.reduce(
    (acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
    [0, 0, 0],
  ).map((sum) => sum / borderSamples.length)

  const THRESHOLD = 28
  let minX = SIZE, minY = SIZE, maxX = -1, maxY = -1
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = (y * SIZE + x) * 3
      const dist = Math.sqrt(
        (data[idx] - bg[0]) ** 2 + (data[idx + 1] - bg[1]) ** 2 + (data[idx + 2] - bg[2]) ** 2,
      )
      if (dist > THRESHOLD) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return {areaRatio: 0, centerDistance: 1}

  const areaRatio = ((maxX - minX + 1) * (maxY - minY + 1)) / (SIZE * SIZE)
  const centerX = (minX + maxX) / 2 / SIZE
  const centerY = (minY + maxY) / 2 / SIZE
  const dx = centerX - 0.5
  const dy = centerY - 0.5
  const centerDistance = Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.sqrt(0.5))
  return {areaRatio, centerDistance}
}

/** 라플라시안 분산 기반 샤프니스 근사 — Apple 미학 점수의 대체 근사치(정확한 대응 아님). */
async function estimateAesthetics(imagePath: string): Promise<{score: number; isUtility: boolean}> {
  const SIZE = 256
  const laplacian = await sharp(imagePath, {failOn: "none"})
    .rotate()
    .resize(SIZE, SIZE, {fit: "fill"})
    .grayscale()
    .convolve({width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]})
    .raw()
    .toBuffer()

  let sum = 0
  let sumSq = 0
  for (let i = 0; i < laplacian.length; i++) {
    sum += laplacian[i]
    sumSq += laplacian[i] * laplacian[i]
  }
  const mean = sum / laplacian.length
  const variance = sumSq / laplacian.length - mean * mean

  // Squash sharpness variance into roughly Apple's -1..1 range. Empirical
  // scaling, not a calibrated equivalent — see module header.
  const score = Math.min(1, Math.max(-1, variance / (variance + 400) * 2 - 0.3))

  const {data} = await sharp(imagePath, {failOn: "none"})
    .rotate()
    .resize(64, 64, {fit: "fill"})
    .grayscale()
    .raw()
    .toBuffer({resolveWithObject: true})
  let flatMean = 0
  for (let i = 0; i < data.length; i++) flatMean += data[i]
  flatMean /= data.length
  let flatVariance = 0
  for (let i = 0; i < data.length; i++) flatVariance += (data[i] - flatMean) ** 2
  flatVariance /= data.length
  const isUtility = flatVariance < 8

  return {score, isUtility}
}

let sharedSession: ort.InferenceSession | null = null
async function getSession(): Promise<ort.InferenceSession> {
  if (!sharedSession) {
    sharedSession = await ort.InferenceSession.create(MODEL_PATH.pathname.replace(/^\/([A-Za-z]:)/, "$1"))
  }
  return sharedSession
}

export class WinProductImageVisionClient {
  #ocrScheduler: Scheduler | null = null
  #closed = false

  // 인물+포즈/전경/샤프니스는 8-way 세마포어(select-product-image.ts)로 병렬인데
  // OCR 워커가 1개면 거기서 직렬화된다 — 워커 풀로 맞춘다.
  async #getOcrScheduler(): Promise<Scheduler> {
    if (!this.#ocrScheduler) {
      const scheduler = createScheduler()
      const workers = await Promise.all(
        Array.from({length: OCR_WORKER_POOL_SIZE}, () => createWorker("eng")),
      )
      for (const worker of workers) scheduler.addWorker(worker)
      this.#ocrScheduler = scheduler
    }
    return this.#ocrScheduler
  }

  async analyze(input: {
    path: string
    url: string
    byteLength: number
    mimeType: string
  }): Promise<ImageCandidateAnalysis> {
    if (this.#closed) throw new Error("vision client is closed")

    const metadata = await sharp(input.path, {failOn: "none"}).metadata()
    const width = metadata.width ?? 0
    const height = metadata.height ?? 0
    const isAnimated = (metadata.pages ?? 1) > 1
    if (width <= 0 || height <= 0) {
      return {
        url: input.url,
        width: 0,
        height: 0,
        byteLength: input.byteLength,
        mimeType: input.mimeType,
        decoded: false,
        isAnimated: false,
        isUtility: false,
        aestheticsScore: -1,
        textCoverage: 0,
        humanConfidence: 0,
        humanAreaRatio: 0,
        humanCenterDistance: 1,
        poseJointCount: 0,
        foregroundAreaRatio: 0,
        foregroundCenterDistance: 1,
      }
    }

    const pre = await preprocess(input.path)
    const session = await getSession()
    const result = await session.run({images: pre.tensor})
    const output = result["output0"].data as Float32Array
    const detections = decode(output, pre)

    let humanConfidence = 0
    let poseJointCount = 0
    let largest: Detection | null = null
    for (const det of detections) {
      humanConfidence = Math.max(humanConfidence, det.confidence)
      poseJointCount = Math.max(poseJointCount, det.keypointConfCount)
      if (!largest || det.box.width * det.box.height > largest.box.width * largest.box.height) {
        largest = det
      }
    }
    const humanAreaRatio = largest ? (largest.box.width * largest.box.height) / (width * height) : 0
    const humanCenterDistance = largest
      ? (() => {
          const cx = (largest!.box.x + largest!.box.width / 2) / width
          const cy = (largest!.box.y + largest!.box.height / 2) / height
          const dx = cx - 0.5
          const dy = cy - 0.5
          return Math.min(1, Math.sqrt(dx * dx + dy * dy) / Math.sqrt(0.5))
        })()
      : 1

    const foreground = await estimateForeground(input.path, width, height)
    const aesthetics = await estimateAesthetics(input.path)

    let textCoverage = 0
    try {
      const scheduler = await this.#getOcrScheduler()
      // 원본 해상도(수천px)를 그대로 넣으면 OCR이 수십 초씩 걸린다 — 텍스트
      // 커버리지는 근사치면 충분하므로 축소본으로 대체한다.
      const OCR_MAX_DIM = 1200
      const ocrScale = Math.min(1, OCR_MAX_DIM / Math.max(width, height))
      const ocrBuffer = await sharp(input.path, {failOn: "none"})
        .rotate()
        .resize(Math.round(width * ocrScale), Math.round(height * ocrScale))
        .toBuffer()
      const {data} = await scheduler.addJob("recognize", ocrBuffer)
      const area = Math.round(width * ocrScale) * Math.round(height * ocrScale)
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of paragraph.lines ?? []) {
            for (const word of line.words ?? []) {
              const bbox = word.bbox
              if (!bbox) continue
              textCoverage += (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0)
            }
          }
        }
      }
      textCoverage = area > 0 ? Math.min(1, textCoverage / area) : 0
    } catch {
      textCoverage = 0
    }

    return {
      url: input.url,
      width,
      height,
      byteLength: input.byteLength,
      mimeType: input.mimeType,
      decoded: true,
      isAnimated,
      isUtility: aesthetics.isUtility || textCoverage > 0.5,
      aestheticsScore: aesthetics.score,
      textCoverage,
      humanConfidence,
      humanAreaRatio,
      humanCenterDistance,
      poseJointCount,
      foregroundAreaRatio: foreground.areaRatio,
      foregroundCenterDistance: foreground.centerDistance,
    }
  }

  async close(): Promise<void> {
    this.#closed = true
    if (this.#ocrScheduler) {
      await this.#ocrScheduler.terminate()
      this.#ocrScheduler = null
    }
  }
}
