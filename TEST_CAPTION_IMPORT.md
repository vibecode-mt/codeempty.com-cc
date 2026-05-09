# Caption Import Feature - End-to-End Test Guide

## Feature Overview
The caption import feature allows users to import captions from CapCut videos (or SRT/VTT files) directly into the project editor, creating steps and content elements with preserved video timestamps.

## Implementation Checklist
- [x] Backend API endpoint created: `POST /api/projects/:id/import-captions`
- [x] Frontend modal component: `CaptionImportModal.tsx`
- [x] Caption parsers: CapCut JSON, SRT, VTT formats with auto-detection
- [x] Integration into ProjectEdit page
- [x] API client method in `admin/src/api.ts`
- [x] Documentation in README.md
- [x] UI bug fix: First caption locked as "Step" (cannot be toggled)
- [x] Build verification: Clean build with no errors
- [x] Dev server verification: Server running and responsive

## Test Scenarios

### Scenario 1: Import from SRT file
**Steps:**
1. Navigate to `/admin/projects/{project-id}`
2. Click the **📥 Import** button in the Steps section
3. Upload a `.srt` file (e.g., test_captions.srt)
4. Verify captions are parsed and displayed in the modal
5. Mark captions as Step or Element (first is locked as Step)
6. Click Import
7. Verify steps and elements appear in the project

**Expected Result:** Steps and elements created with correct timestamps, sorted by time

### Scenario 2: Import from CapCut JSON
**Steps:**
1. Extract `draft_content.json` from CapCut project
2. Upload to import modal
3. Verify CapCut-specific text parsing works
4. Mark captions as Step or Element
5. Click Import

**Expected Result:** Captions from CapCut JSON parsed correctly with microsecond→millisecond conversion

### Scenario 3: First caption type validation
**Steps:**
1. Upload a caption file with auto-detected steps
2. Observe first caption is locked as "Step"
3. Try clicking the button for first caption
4. Verify button is disabled with tooltip "First caption must be a step"
5. Try toggling other captions - should work normally
6. Skip first caption checkbox
7. Try importing - should fail with error "First selected caption must be marked as a step"

**Expected Result:**
- First caption has disabled toggle button with tooltip
- Other captions can be toggled freely
- Backend validation prevents importing if first selected caption isn't a step

### Scenario 4: File format auto-detection
**Upload files with different formats:**
- CapCut JSON (starts with `{` and has `materials`/`tracks`)
- SRT (contains timecode format `HH:MM:SS,mmm --> HH:MM:SS,mmm`)
- VTT (starts with `WEBVTT` header)

**Expected Result:** Format automatically detected and parsed correctly

## Known Limitations
1. CapCut JSON parsing requires `draft_content.json` structure
2. SRT timestamps have millisecond precision (not microsecond like CapCut)
3. First caption cannot be an element (enforced at UI and API level)

## Implementation Files
- **Backend:** `src/api/projects.ts` (lines 293-395)
- **Frontend Modal:** `admin/src/components/CaptionImportModal.tsx`
- **Parsers:** 
  - Backend: `src/caption-parsers.ts`
  - Frontend: `admin/src/caption-parsers.ts`
- **Integration:** `admin/src/pages/ProjectEdit.tsx`
- **API Client:** `admin/src/api.ts`
- **Documentation:** `README.md` (Importing Captions from CapCut section)

## Build Status
✓ Admin SPA builds successfully with no TypeScript errors
✓ Dev server running and responsive at `http://localhost:8788/admin`
✓ All necessary files created and integrated
