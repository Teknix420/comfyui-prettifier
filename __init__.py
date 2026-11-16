"""ComfyUI Prettifier.

A frontend-only extension that rearranges a workflow so it is easier to read:
layered auto-layout, link straightening, node resizing, grouping, alignment tools.
All the work happens in the browser (see ./web); this module only tells ComfyUI
where the JavaScript lives.
"""

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
