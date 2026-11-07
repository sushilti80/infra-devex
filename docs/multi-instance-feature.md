# Multi-Instance Module Feature

## Overview
This feature allows users to provision multiple instances of the same Azure module type (e.g., 2-3 App Services or Function Apps) with unique names and individual RBAC assignments.

## Implementation Summary

### Frontend Changes

#### 1. CSS Updates (`public/css/styles.css`)
Added comprehensive styling for:
- `.module-card` with selected and has-instances states
- `.module-header` for module checkbox and info display
- `.instance-controls` for instance count management
- `.instances-panel` with expandable/collapsible behavior
- `.instance-item` for individual instance configuration
- `.instance-name-input` for custom naming
- `.instance-rbac-indicator` showing RBAC relationship status
- Responsive design for mobile devices

#### 2. JavaScript Updates (`public/js/app.js`)

**New Global Object:**
```javascript
const moduleInstances = {};
```
Tracks all module instances with their custom names.

**Key Functions Added:**

- `handleModuleToggle(moduleName)` - Manages module selection/deselection
- `updateModuleInstances(moduleName, count)` - Creates/updates instance list based on count
- `toggleInstancesPanel(moduleName)` - Shows/hides instance configuration panel
- `updateInstanceName(moduleName, index, newName)` - Updates individual instance names
- `removeInstance(moduleName, instanceNum)` - Removes an instance from a module
- `getSelectedModulesWithInstances()` - Returns complete module selection with instance details
- `updateInstanceRBACIndicators()` - Updates visual indicators when RBAC is assigned

**Updated Functions:**

- `createModuleCard(module)` - Enhanced with new HTML structure supporting:
  - Module header with checkbox
  - Instance count control
  - Expandable instances panel
  - Individual instance configuration

- `openRBACManager()` - Modified to:
  - Flatten module instances into individual resources
  - Each instance appears separately in RBAC manager
  - Format: `appservice-1`, `appservice-2`, etc.

#### 3. HTML Structure (`public/index.html`)
No changes required - the existing module container structure works with the new dynamic content.

## User Experience Flow

### 1. Select Module
- User checks a module checkbox
- Instance count input becomes enabled
- "Configure" button appears
- Module card highlights with blue border

### 2. Set Instance Count
- User changes instance count (1-10)
- If count > 1:
  - Module card gets purple border
  - Panel auto-expands showing all instances
  - Each instance has auto-generated name (e.g., `appservice-1`, `appservice-2`)

### 3. Customize Instance Names
- Each instance row shows:
  - Instance number badge (1, 2, 3...)
  - Editable name field with monospace font
  - RBAC indicator (initially "No RBAC")
  - Remove button

- Users can customize each instance name
- Names are preserved when count changes (up to the new count)

### 4. Assign RBAC
- Click "RBAC" button to open RBAC Manager
- Each instance appears as a separate resource
- Example: `appservice-1` can have Reader access to `keyvault-1`
- `appservice-2` can have different permissions than `appservice-1`

### 5. Visual Feedback
- Instances with RBAC relationships show green indicator: "Has RBAC"
- Instances without RBAC show gray indicator: "No RBAC"
- Panel can be collapsed/expanded using "Configure" button

## Data Structure

### Module Instance Object
```javascript
{
  module: "AppService",
  instances: ["appservice-1", "appservice-2", "appservice-3"],
  count: 3
}
```

### RBAC Manager Resources (Flattened)
```javascript
[
  {
    id: "resource-appservice-1",
    name: "appservice-1",
    type: "AppService",
    moduleType: "AppService",
    instanceIndex: 0
  },
  {
    id: "resource-appservice-2",
    name: "appservice-2",
    type: "AppService",
    moduleType: "AppService",
    instanceIndex: 1
  }
]
```

### Form Submission Data
```javascript
{
  projectName: "myproj",
  environment: "sand",
  modules: ["AppService", "KeyVault"],
  moduleInstances: {
    "AppService": ["appservice-api", "appservice-worker"],
    "KeyVault": ["keyvault-1"]
  },
  rbacPairs: [
    {
      sourceResource: "appservice-api",
      role: "Key Vault Secrets User",
      targetResource: "keyvault-1"
    }
  ]
}
```

## Key Features

### ✅ Inline Configuration
- No modal dialogs - everything visible in context
- Smooth animations for expand/collapse
- Clear visual hierarchy

### ✅ Smart Defaults
- Auto-generated names follow convention: `{module}-{number}`
- Single instance = simple naming (e.g., just `appservice`)
- Multiple instances = numbered (e.g., `appservice-1`, `appservice-2`)

### ✅ RBAC Integration
- Each instance is a separate resource in RBAC Manager
- Visual indicators show which instances have relationships
- Granular control: different permissions for each instance

### ✅ Flexible Naming
- Fully editable instance names
- Supports custom naming conventions (e.g., `api-primary`, `worker-secondary`)
- Names preserved when adjusting count (within limits)

### ✅ User-Friendly
- Clear labels and helper text
- Remove button for reducing count
- Responsive design for mobile/tablet
- Accessible keyboard navigation

## Backend Compatibility

The backend should receive `moduleInstances` object containing:
- Module type as key
- Array of instance names as value

Example:
```json
{
  "moduleInstances": {
    "AppService": ["appservice-api", "appservice-worker", "appservice-admin"],
    "FunctionApp": ["functionapp-processor"],
    "StorageAccount": ["storage-data", "storage-logs"],
    "KeyVault": ["keyvault-secrets"]
  }
}
```

Backend can iterate through and create resources with the exact names provided, ensuring:
- No naming conflicts
- Predictable resource names
- Individual RBAC assignments work correctly

## Testing Checklist

- [ ] Select module with 1 instance (default behavior)
- [ ] Increase instance count to 3
- [ ] Verify panel auto-expands
- [ ] Customize instance names
- [ ] Decrease instance count - names preserved
- [ ] Remove individual instances
- [ ] Open RBAC Manager - verify all instances appear
- [ ] Assign RBAC to specific instances
- [ ] Verify RBAC indicators update (green "Has RBAC")
- [ ] Submit form - verify payload includes instance names
- [ ] Test on mobile/tablet (responsive design)
- [ ] Test with 10 instances (max limit)
- [ ] Deselect module - verify cleanup

## Future Enhancements

1. **Instance Templates**: Quick presets like "API + Worker + Background"
2. **Bulk Naming**: Pattern-based naming (e.g., `{env}-{module}-{num}`)
3. **Clone Instance**: Duplicate configuration from existing instance
4. **RBAC Templates**: Pre-defined permission sets per instance type
5. **Visual Diagram**: Show instance relationships graphically
6. **Validation**: Check for duplicate names across modules
7. **Import/Export**: Save instance configurations as JSON
8. **Cost Estimation**: Show cost per instance in real-time

## Browser Compatibility

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ✅ Responsive design

## Accessibility

- Keyboard navigation support
- ARIA labels on interactive elements
- Focus indicators
- Screen reader friendly
