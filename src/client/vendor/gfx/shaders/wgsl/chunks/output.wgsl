// Linear to what the target stores: sRGB for the canvas, linear for anything read back.
#ifdef SRGB_OUTPUT
fn linearToOutputTexel(value: vec4f) -> vec4f { return sRGBTransferOETF(value); }
#else
fn linearToOutputTexel(value: vec4f) -> vec4f { return value; }
#endif
