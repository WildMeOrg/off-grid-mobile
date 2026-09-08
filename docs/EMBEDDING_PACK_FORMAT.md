# Embedding pack format specification

**Version:** 1.0
**Date:** 2026-02-25
**Purpose:** Defines the v1 file format for embedding packs consumed by EleBook for offline individual wildlife re-identification, including guidance for a Wildbook exporter.

*Updated: 2026-09-07 - Aligned mobile acquisition, validation, and model compatibility with the current consumer.*

---

## Overview

An **embedding pack** is a self-contained zip archive that enables offline re-identification of individual animals for a single species and feature class (e.g., "horse faces", "whale shark left flank"). It contains:

1. A species-specific **detector model** (ONNX format) for locating animals in photos
2. Pre-computed **MiewID embedding vectors** for all known individuals
3. **Reference photographs** for visual comparison during match review
4. **Metadata** mapping embeddings to individual identities
5. **Configuration** for the detector's preprocessing pipeline

The Wildbook exporter workflow below is a producer-side design, not an implemented mobile export or direct Wildbook sync feature. A researcher would run an Encounter Search for a synthetic scope such as `example-project`, then export the results as an embedding pack. Such an exporter would:

1. Query all Encounters matching the search criteria
2. Group them by Individual (Marked Individual)
3. Run MiewID on each Encounter's annotation to extract embeddings (or retrieve cached embeddings)
4. Collect representative reference photos per individual
5. Bundle the species-appropriate detector model
6. Package everything into the zip format described below

EleBook currently resolves packs from the configured backend's `GET /projects/{project_id}/packs/latest` endpoint. It downloads the returned archive URL and installs a validated candidate. The shared embedding model is resolved separately through `GET /models/{model_name}/latest`; `wildbookInstanceUrl` and `huggingFaceRepo` do not select these download endpoints. See [setup](setup.md) and [API behavior](api.md) for deployment configuration and the mobile API contract.

---

## File structure

```text
{species}-{context}-{date}.zip
├── manifest.json
├── models/
│   └── {detector-filename}.onnx
├── embeddings/
│   ├── index.json
│   └── embeddings.bin
├── reference_photos/
│   ├── {individual-id-1}/
│   │   ├── ref_01.jpg
│   │   ├── ref_02.jpg
│   │   └── ref_03.jpg
│   ├── {individual-id-2}/
│   │   └── ref_01.jpg
│   └── ...
└── config/
    └── detector.json
```

### Naming convention

The zip filename follows the pattern: `{species}-{context}-{YYYY-MM}.zip`

Examples:

- `horse-example-project-2026-03.zip`
- `whale-shark-example-project-2026-01.zip`
- `giraffe-example-project-2026-06.zip`

The filename is informational only. The manifest describes the species, feature class, and provenance; the download request supplies the project ID used to register the pack.

---

## manifest.json

The top-level manifest describes the pack contents and provenance.

```json
{
  "formatVersion": "1.0",
  "species": "horse",
  "featureClass": "horse+face",
  "displayName": "Example project horses",
  "description": "Two synthetic individuals for example-project",
  "wildbookInstanceUrl": "https://wildbook.example.invalid",
  "wildbookVersion": "9.x.x",
  "exportDate": "2026-03-15T14:30:00Z",
  "exportedBy": "researcher@example.invalid",
  "searchQuery": "projectId=example-project AND species=horse",
  "individualCount": 2,
  "embeddingCount": 8,
  "embeddingDim": 2152,
  "embeddingModel": {
    "name": "miewid-v4",
    "version": "4.1.0",
    "huggingFaceRepo": "example-project/miewid",
    "inputSize": [440, 440],
    "normalize": {
      "mean": [0.485, 0.456, 0.406],
      "std": [0.229, 0.224, 0.225]
    }
  },
  "detectorModel": {
    "filename": "horse-face-yolo11n.onnx",
    "configFile": "config/detector.json"
  },
  "checksums": {
    "embeddings.bin": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "horse-face-yolo11n.onnx": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
  }
}
```

All identities and provenance values in these examples are synthetic. Replace the illustrative checksum values with hashes of the actual files before producing a pack.

### Field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `formatVersion` | string | Yes | Pack format version. Currently `"1.0"`. The mobile app uses this to determine compatibility. |
| `species` | string | Yes | Species common name, lowercase. Must match Wildbook's species taxonomy key. |
| `featureClass` | string | Yes | The annotation feature class in Wildbook's IA pipeline (e.g., `"horse+face"`, `"whale_shark+left"`, `"giraffe+flank"`). This determines which detector model to use and which body region the embeddings represent. Follows Wildbook's `{species}+{viewpoint}` convention. |
| `displayName` | string | Yes | Human-readable name shown in the mobile app's pack selector. |
| `description` | string | No | Optional exporter description. Not copied into the current installed pack record. |
| `wildbookInstanceUrl` | string | Yes | Source-instance provenance. The current mobile upload target is the configured EleBook backend, not this URL. |
| `wildbookVersion` | string | No | Version of the Wildbook instance at export time. Informational. |
| `exportDate` | string (ISO 8601) | Yes | When this pack was exported. Retained as provenance; the backend download flow checks artifact version and hash for updates. |
| `exportedBy` | string | No | Email or username of the researcher who exported the pack. |
| `searchQuery` | string | No | The Encounter Search query that produced this pack. Informational, helps researchers understand scope. |
| `individualCount` | integer | Yes | Number of distinct individuals in the pack. |
| `embeddingCount` | integer | Yes | Total number of embedding vectors in `embeddings.bin`. This is >= `individualCount` because each individual may have multiple embeddings from different Encounters/photos. |
| `embeddingDim` | integer | Yes | Dimensionality of each embedding vector. The current MiewID v4.1 contract uses raw 2152-dimensional BatchNorm output. |
| `embeddingModel` | object | Yes | Describes the embedding model used. See sub-fields below. |
| `embeddingModel.name` | string | Yes | Model identifier (e.g., `"miewid-v4"`). |
| `embeddingModel.version` | string | Yes | Model version. Installation and inference require the same normalized semantic version as the installed model; mismatches are incompatible. |
| `embeddingModel.huggingFaceRepo` | string | No | Optional model provenance. The current mobile resolver does not download from this field. |
| `embeddingModel.inputSize` | [int, int] | Yes | Expected input dimensions [height, width] in pixels. MiewID expects [440, 440]. |
| `embeddingModel.normalize` | object | Yes | ImageNet normalization parameters. `mean` and `std` are arrays of 3 floats (RGB channels). |
| `detectorModel` | object | Yes | Describes the bundled detector model. See sub-fields below. |
| `detectorModel.filename` | string | Yes | Filename of the ONNX detector model in the `models/` directory. |
| `detectorModel.configFile` | string | Yes | Relative path to the detector configuration file. |
| `checksums` | object | No | SHA-256 checksums for listed files. Keys may be bare filenames or pack-relative paths such as `embeddings/embeddings.bin`. Values may be hex or `sha256:{hex}` (case-insensitive). Only declared entries are verified during a full pack validation. |

### Mobile validation

The required fields above describe the v1 producer contract, not a complete runtime schema. The current validator checks core manifest structure, supported format major version, required file presence, binary byte length, and individual embedding ranges. It does not exhaustively validate provenance fields, detector configuration, reference-photo requirements, or agreement between the declared individual count and the index.

Bare file references are searched in the pack root, then `embeddings/`, `models/`, and `config/`. Nested relative paths are allowed, but absolute paths, dot segments, empty segments, backslashes, URI/drive syntax, percent escapes, query/fragment characters, control characters, and leading/trailing segment whitespace are rejected. Individual IDs must be single safe directory names; reference-photo names follow the same relative-path rules. These checks also run when checksum hashing is skipped.

The manifest, required files, checksum targets, and displayed reference photos must resolve canonically inside the pack directory. Missing canonical-path information and symlinks resolving outside it are rejected. The version-pinned `react-native-fs` patch supplies canonical paths on Android and iOS. Activation has no unchecked path fallback, and installed indexes are checked again before returning individual/photo references.

The application uses its native unzip library before validating extracted contents; it does not implement a separate archive-entry preflight. These read/activation checks are not an archive signature, a defense against a compromised operating system, or a guarantee against concurrent filesystem tampering. Use trusted pack producers and maintain the native extraction libraries.

Manifest checksums are optional and cover only the entries supplied. Startup reconciliation skips hashing for packs with a previous validation timestamp, while retaining file, size, and range checks. The backend download flow separately requires an archive `sha256` of 64 hex characters without the `sha256:` prefix and passes the expected byte size to the downloader. Archive integrity is checked before extraction. These hashes are not publisher signatures.

---

## models/ directory

Contains the species-specific detector model in ONNX format.

### Detector model requirements

- **Format:** ONNX (Open Neural Network Exchange)
- **Input:** The mobile path supplies a float32 tensor shaped `[1, 3, height, width]`.
- **Compatibility:** Verify the exported artifact's operators, input type, and output layout with the app's ONNX runtime. An opset number alone does not establish compatibility.
- **Quantization:** Weight precision may vary, but the model must accept the supplied float32 input. Float16 or integer input tensors require a different input path.
- **Illustrative size:** 5-30 MB depending on architecture and export; use artifact metadata for the actual size.

The detector model is specific to a species and feature class. Exporter naming examples (not a list of implemented decoders):

- `horse-face-yolo11n.onnx` - detects horse faces
- `whale-shark-yolov8s.onnx` - detects whale sharks (full body)
- `giraffe-flank-efficientdet.onnx` - detects giraffe flanks

**Important:** MiewID (the embedding model) is not included in the pack. It is downloaded separately from the configured backend's model endpoint; model weights are not committed in this repository. The pack references the MiewID version used to generate its embeddings. Detector artifacts remain ONNX even when an Android installation uses a TFLite embedding model.

Detection runs on ONNX CPU. Embeddings use ONNX CPU or the optional Android TFLite/LiteRT path, which can use GPU acceleration. Runtime failures are surfaced to the pipeline; the embedding service does not automatically download or retry an alternative ONNX artifact when LiteRT fails.

---

## config/detector.json

Describes preprocessing and output metadata for the bundled detector model. The current mobile path supports the YOLOv8/YOLO11-style single-output layout described below; configuration fields do not make arbitrary detector architectures supported.

```json
{
  "modelFile": "horse-face-yolo11n.onnx",
  "architecture": "yolo11",
  "inputSize": [640, 640],
  "inputChannels": 3,
  "channelOrder": "RGB",
  "normalize": {
    "mean": [0.0, 0.0, 0.0],
    "std": [1.0, 1.0, 1.0],
    "scale": 0.00392156862
  },
  "confidenceThreshold": 0.5,
  "nmsThreshold": 0.45,
  "maxDetections": 20,
  "outputFormat": "yolo",
  "classLabels": ["horse_face"],
  "outputSpec": {
    "boxFormat": "cxcywh",
    "coordinateType": "absolute",
    "outputTensorName": "output0",
    "layout": "batch_attributes_detections"
  }
}
```

### Field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `modelFile` | string | Yes | Filename of the ONNX model in `models/`. Must match `manifest.json`. |
| `architecture` | string | Yes | Descriptive detector family, e.g. `"yolo11"` or `"yolov8"`. The current mobile path does not select a decoder from this field. |
| `inputSize` | [int, int] | Yes | Model input dimensions [height, width]. The current preprocessing contract stretch-resizes the full image, without letterboxing. |
| `inputChannels` | integer | Yes | Number of input channels. Always `3` (RGB). |
| `channelOrder` | string | Yes | `"RGB"` or `"BGR"`. The mobile app reorders channels if needed. |
| `normalize.mean` | [float, float, float] | Yes | Per-channel mean subtraction values. YOLO models typically use `[0, 0, 0]`. |
| `normalize.std` | [float, float, float] | Yes | Per-channel standard deviation divisors. YOLO models typically use `[1, 1, 1]`. |
| `normalize.scale` | float | Yes | Pixel value scaling factor applied BEFORE mean/std normalization. `1/255 = 0.00392156862` converts uint8 [0-255] to float [0-1]. Set to `1.0` if the model expects [0-255] input. |
| `confidenceThreshold` | float | Yes | Minimum detection confidence score [0-1]. Detections below this are discarded. |
| `nmsThreshold` | float | Yes | IoU threshold for non-max suppression [0-1]. Lower-scoring overlapping boxes are suppressed, not merged; suppression is across class labels. |
| `maxDetections` | integer | Yes | Maximum number of detections returned after NMS; not a limit on the model's output allocation. |
| `outputFormat` | string | Yes | Intended output family. Use `"yolo"` for the implemented path. Values such as `"ssd"` or `"efficientdet"` do not activate another decoder. |
| `classLabels` | [string] | Yes | Ordered list of class label strings. Index position corresponds to class ID in the model output. Single-class detectors have one entry. |
| `outputSpec` | object | Yes | Describes the output tensor layout. See sub-fields below. |
| `outputSpec.boxFormat` | string | Yes | `"xyxy"` means (x1, y1, x2, y2); `"xywh"` means (top-left x, top-left y, width, height); `"cxcywh"` means (center x, center y, width, height). |
| `outputSpec.coordinateType` | string | Yes | `"normalized"` (0-1 relative to input size) or `"absolute"` (pixel coordinates). |
| `outputSpec.outputTensorName` | string | No | Name of the output tensor to read. If omitted, uses the first output tensor. |
| `outputSpec.layout` | string | Yes | Descriptive layout metadata. The current parser assumes `[1, 4+C, N]` (`"batch_attributes_detections"`), where C is the number of class labels and N is the number of detections. It does not dispatch on this string or accept an extra objectness row. |

### Post-processing by architecture

The mobile runtime always calls its YOLO parser, regardless of `architecture`, `outputFormat`, or `outputSpec.layout`.

**Implemented `yolo11` / `yolov8` layout:**

1. Read row-major output `[1, 4+C, N]`: four coordinate rows followed by one confidence row per class, with no separate objectness value.
2. For each detection, select the highest class confidence and apply `confidenceThreshold`.
3. Convert coordinates using `boxFormat` and `coordinateType`; normalize to original-image fractions under the stretch-resize contract.
4. Clamp box corners to the image bounds and discard invalid or empty boxes.
5. Sort by confidence, apply class-agnostic NMS, and return at most `maxDetections`, mapping class indices through `classLabels`.

**Exporter designs for `efficientdet` / `ssd`:**

These families may expose boxes `[1, N, 4]`, scores `[1, N, C]`, and optional detection counts as separate tensors. Extracting these outputs and applying thresholding/NMS would require another mobile decoder; that path is not implemented here.

---

## embeddings/ directory

Contains the pre-computed MiewID embedding vectors and their metadata.

### embeddings/index.json

Maps individuals to their embedding vectors and reference photos.

```json
{
  "formatVersion": "1.0",
  "generatedWith": "miewid-v4",
  "individuals": [
    {
      "id": "SYNTHETIC-001",
      "name": "Example individual 1",
      "alternateId": "EXAMPLE-001",
      "sex": "female",
      "lifeStage": "adult",
      "firstSeen": "2024-06-15",
      "lastSeen": "2026-02-10",
      "encounterCount": 12,
      "embeddingCount": 5,
      "embeddingOffset": 0,
      "referencePhotos": ["ref_01.jpg", "ref_02.jpg", "ref_03.jpg"],
      "notes": "Distinctive white blaze on forehead"
    },
    {
      "id": "SYNTHETIC-002",
      "name": "Example individual 2",
      "alternateId": null,
      "sex": "male",
      "lifeStage": "adult",
      "firstSeen": "2025-01-20",
      "lastSeen": "2026-03-01",
      "encounterCount": 8,
      "embeddingCount": 3,
      "embeddingOffset": 5,
      "referencePhotos": ["ref_01.jpg"],
      "notes": null
    }
  ]
}
```

### Individual field reference

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Stable source individual identifier, such as Wildbook's `MarkedIndividual.individualID`. Used for local matching and submitted as the chosen identity to the configured backend; this does not imply direct Wildbook sync. |
| `name` | string | No | Display name for the individual. May be null for unnamed animals. |
| `alternateId` | string | No | Alternative identifier (e.g., researcher's field ID, tattoo number, band number). |
| `sex` | string | No | `"male"`, `"female"`, `"unknown"`, or null. From Wildbook's individual record. |
| `lifeStage` | string | No | `"adult"`, `"subadult"`, `"juvenile"`, `"calf"`, `"unknown"`, or null. |
| `firstSeen` | string (ISO date) | No | Date of first Encounter in Wildbook. Helps field users assess if a match makes temporal sense. |
| `lastSeen` | string (ISO date) | No | Date of most recent Encounter. |
| `encounterCount` | integer | No | Total Encounters in Wildbook for this individual. Indicates how well-known this animal is. |
| `embeddingCount` | integer | Yes | Number of embedding vectors for this individual in `embeddings.bin`. |
| `embeddingOffset` | integer | Yes | Starting index (0-based) of this individual's vectors in `embeddings.bin`. Vectors for this individual occupy indices `[embeddingOffset, embeddingOffset + embeddingCount)`. |
| `referencePhotos` | [string] | Yes | Filenames of reference photos in `reference_photos/{id}/`. Ordered by quality/representativeness (best first). At least 1 required. |
| `notes` | string | No | Free-form notes about distinguishing features. Shown to the user during match review. |

### embeddings.bin format

A flat binary file containing all embedding vectors packed sequentially as **little-endian float32** values.

**Layout:**
```text
[vector_0: 2152 x float32][vector_1: 2152 x float32]...[vector_N: 2152 x float32]
```

**Reading a specific individual's embeddings:**
```text
byte_offset = individual.embeddingOffset * embeddingDim * 4
byte_length = individual.embeddingCount * embeddingDim * 4
```

For MiewID v4.1 with `embeddingDim = 2152`:
- Each vector: 2152 * 4 = 8,608 bytes
- The eight-vector example above: 8 * 8,608 = 68,864 bytes
- A larger pack with 635 vectors: 635 * 8,608 = 5,466,080 bytes (~5.2 MB)

Store the raw BatchNorm embeddings without L2 normalization. Matching uses full cosine similarity, dividing the dot product by both vector norms. A top similarity score is not a calibrated identity probability or a scientifically confirmed identity.

**Why flat binary instead of JSON/numpy:**
- No per-number JSON parsing; vectors can be read from fixed offsets
- Compact - no key names or formatting characters
- Compatible with typed arrays in JavaScript (`Float32Array`) and native buffers

**Endianness:** Little-endian (matches ARM and x86 architectures used by iOS and Android).

**Precision:** Float32 (4 bytes per value). Float16 could halve the size but introduces quantization error in cosine similarity. For <500 individuals, Float32 is negligible in size and preserves full precision.

---

## reference_photos/ directory

Contains representative photographs of each known individual, organized by individual ID.

```text
reference_photos/
├── SYNTHETIC-001/
│   ├── ref_01.jpg      ← best/most representative
│   ├── ref_02.jpg
│   └── ref_03.jpg
├── SYNTHETIC-002/
│   └── ref_01.jpg
└── ...
```

### Photo requirements

| Property | Requirement | Rationale |
|---|---|---|
| **Format** | JPEG | Universal mobile compatibility, good compression |
| **Resolution** | 512x512 max (longest side) | Large enough for visual comparison, small enough for mobile storage |
| **Quality** | JPEG quality 80 | Good visual quality at reasonable file size (~30-80 KB per photo) |
| **Count per individual** | 1-3 photos | Best photo first; more photos help verification but increase pack size |
| **Content** | Cropped to the annotation region (same crop the detector would produce) | Shows exactly what the detector will crop, making visual comparison meaningful |
| **Naming** | `ref_01.jpg`, `ref_02.jpg`, etc. | Simple sequential naming, referenced by `index.json` |

### Selection criteria for a Wildbook exporter

When selecting reference photos from an individual's Encounters, the exporter should prefer:

1. **Highest quality** annotations (sharpest, best lighting, least occlusion)
2. **Most recent** Encounters (animal's current appearance)
3. **Diverse viewpoints** if available (different angles of the same feature)
4. **Annotations that produced high-confidence MiewID matches** in Wildbook (proven discriminative photos)

The exporter should avoid:
- Blurry or heavily occluded annotations
- Very old photos where the animal's appearance may have changed
- Duplicate/near-duplicate photos from the same Encounter

---

## Wildbook exporter implementation guide

This section preserves producer-side guidance for implementing an Encounter Search export in Wildbook. It is not a description of server code in this repository or endpoints currently called by EleBook.

### Export trigger

The export is triggered from Wildbook's Encounter Search results page. After a researcher runs a search, they select "Export as Embedding Pack" from the export options. This is analogous to existing export formats (Excel, GIS, email).

### Exporter workflow

```text
1. GATHER ENCOUNTERS
   ├── Execute the Encounter Search query
   ├── Filter to Encounters that have:
   │   ├── At least one Annotation with the target feature class
   │   ├── An assigned Individual (MarkedIndividual)
   │   └── A usable media asset (photo, not video)
   └── Group Encounters by Individual

2. EXTRACT EMBEDDINGS
   ├── For each Encounter's Annotation:
   │   ├── Check if a cached MiewID embedding exists in Wildbook's database
   │   ├── If cached: retrieve the embedding vector
   │   ├── If not cached: send to WBIA for MiewID inference, cache the result
   │   └── Record the embedding vector (2152 x float32)
   └── Associate each embedding with its source Individual

3. SELECT REFERENCE PHOTOS
   ├── For each Individual:
   │   ├── Rank their Annotations by quality (sharpness, recency, match confidence)
   │   ├── Select top 1-3 annotations
   │   ├── Crop the annotation region from the source MediaAsset
   │   ├── Resize to 512x512 max (longest side), JPEG quality 80
   │   └── Save as ref_01.jpg, ref_02.jpg, etc.
   └── Record filenames in index.json

4. BUNDLE DETECTOR MODEL
   ├── Look up the ONNX detector model for the target feature class
   │   (e.g., feature class "horse+face" maps to "horse-face-yolo11n.onnx")
   ├── The model file and its detector.json config are managed as
   │   Wildbook server assets (uploaded by admin, versioned)
   └── Copy model + config into the pack

5. BUILD INDEX
   ├── Create index.json with all individual metadata
   ├── Compute embedding offsets (sequential packing order)
   ├── Write embeddings.bin as flat float32 binary
   └── Compute SHA-256 checksums for embeddings.bin and model file

6. CREATE MANIFEST
   ├── Populate manifest.json with all metadata
   ├── Include the search query for provenance
  ├── Include the Wildbook instance URL for provenance
   └── Record the MiewID version used for embeddings

7. PACKAGE
   ├── Zip all files into {species}-{context}-{date}.zip
   ├── Use ZIP deflate compression (good for binary + JPEG mix)
   └── Serve for download or push to a staging URL
```

### Wildbook data model mapping

| Pack Field | Wildbook Source |
|---|---|
| `individual.id` | `MarkedIndividual.individualID` |
| `individual.name` | `MarkedIndividual.nickname` or `MarkedIndividual.alternateID` |
| `individual.sex` | `MarkedIndividual.sex` |
| `individual.firstSeen` | Earliest `Encounter.dateInMilliseconds` for this individual |
| `individual.lastSeen` | Latest `Encounter.dateInMilliseconds` for this individual |
| `individual.encounterCount` | `MarkedIndividual.encounters.size()` |
| Reference photo source | `Annotation.mediaAsset` cropped by `Annotation.bbox` |
| Embedding source | WBIA MiewID plugin result for `Annotation` |
| `manifest.species` | `Encounter.genus + species` or taxonomy key |
| `manifest.featureClass` | `Annotation.iaClass` (IA class label) |
| `manifest.wildbookInstanceUrl` | Server's configured public URL |
| `manifest.searchQuery` | The `SearchQuery` object serialized as a filter string |

### Embedding caching in Wildbook

To avoid re-running MiewID inference on every export, Wildbook should cache embeddings:

- **Storage:** A new table or column on `Annotation` storing the MiewID embedding vector and the model version that produced it.
- **Invalidation:** If MiewID is updated to a new version, cached embeddings for the old version should be marked stale and re-computed on next export.
- **Schema suggestion:**
  ```sql
  ALTER TABLE annotation ADD COLUMN miewid_embedding BYTEA;
  ALTER TABLE annotation ADD COLUMN miewid_version VARCHAR(32);
  ALTER TABLE annotation ADD COLUMN miewid_computed_at TIMESTAMP;
  ```

### Detector model management

Detector models are server-side assets managed by Wildbook administrators:

- Each `iaClass` (feature class) maps to one detector ONNX model + config
- Models are uploaded via Wildbook admin UI and versioned
- When a new detector version is available, packs exported with the old version should prompt users to re-download
- **Storage suggestion:** A `detector_models` table mapping `iaClass` to model file path, config JSON, and version string

### API endpoint suggestion

```text
POST /api/v1/embedding-packs/export
Content-Type: application/json

{
  "searchQuery": { ... },     // Encounter Search criteria
  "featureClass": "horse+face",
  "maxReferencePhotos": 3,
  "photoMaxSize": 512,
  "photoQuality": 80
}

Response:
202 Accepted
{
  "packId": "uuid",
  "status": "generating",
  "estimatedSize": "35 MB",
  "pollUrl": "/api/v1/embedding-packs/uuid/status"
}
```

In this proposed exporter API, generation would be asynchronous because it may require inference on uncached annotations. An export client would poll the status endpoint before downloading. EleBook currently requests the latest published pack from its configured backend and does not implement this export/poll workflow.

```text
GET /api/v1/embedding-packs/{packId}/status

Response (in progress):
200 OK
{ "status": "generating", "progress": 0.45, "message": "Computing embeddings: 285/635" }

Response (complete):
200 OK
{ "status": "ready", "downloadUrl": "/api/v1/embedding-packs/{packId}/download", "size": 36421632 }
```

```text
GET /api/v1/embedding-packs/{packId}/download

Response:
200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="horse-example-project-2026-03.zip"
[binary zip data]
```

### Pack updates

When a researcher wants an updated pack (new individuals identified, better photos available):

1. Re-run the same Encounter Search
2. Export a new archive and publish it through the configured backend
3. EleBook checks the published version and archive hash when checking for updates
4. Download and validate a candidate before activating it with a compatible embedding model

The current download flow keeps one active pack per project in the store. Prior version directories remain on disk; activating a new pack is not a deletion of all older pack data. Incremental/delta packs are outside the implemented acquisition flow.

---

## Size estimates

| Component | Per Individual | 127 Individuals | 500 Individuals |
|---|---|---|---|
| Embeddings (5 vectors avg, float32) | 43 KB | 5.3 MB | 21 MB |
| Reference photos (2 photos avg, 50 KB each) | 100 KB | 12.4 MB | 49 MB |
| Individual metadata (index.json) | ~0.3 KB | 38 KB | 150 KB |
| Detector model (ONNX, FP16) | N/A | 15-30 MB | 15-30 MB |
| Manifest + config | N/A | ~2 KB | ~2 KB |
| **Total (uncompressed)** | N/A | **~35-48 MB** | **~85-100 MB** |
| **Total (zip compressed, est.)** | N/A | **~25-35 MB** | **~65-80 MB** |

These are illustrative sizing estimates, not installed-artifact guarantees. The separately downloaded MiewID model's size and format come from backend artifact metadata.

---

## Versioning and compatibility

### Format versioning

The v1 format permits optional additions within major version 1. The current validator reads the numeric component before the first `.`; it does not perform full semantic-version syntax validation:

- **1.x** - Accepted subject to the remaining pack checks.
- **2.0** - Rejected by the current consumer; support requires a consumer update.

### MiewID version compatibility

The mobile app downloads MiewID separately and requires an exact normalized version match with `embeddingModel.version`. Normalization permits a leading `v` and an omitted patch component (`v4.1` and `4.1.0` are equivalent).

- Any major, minor, or patch mismatch is incompatible, as is an unrecognized version such as `legacy-unknown`.
- Matching dimensions alone do not establish compatible embedding spaces. Re-export with the installed model version or install the version required by the pack.

### Pack staleness

`exportDate` records provenance. Acquisition freshness is based on the backend's latest artifact version and SHA-256, not a configurable age threshold. Even a current published pack may be missing recently identified individuals.
