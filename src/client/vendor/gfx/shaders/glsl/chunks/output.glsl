// Linear to what the target stores: sRGB for the canvas, linear for anything read back.
#ifdef SRGB_OUTPUT
  vec4 linearToOutputTexel( vec4 value ) { return sRGBTransferOETF( value ); }
#else
  vec4 linearToOutputTexel( vec4 value ) { return value; }
#endif
