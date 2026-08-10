#!/usr/bin/env python3
import sys
import os
import asyncio
import edge_tts

async def main():
    if len(sys.argv) < 3:
        print("Usage: python tts_edge.py <input_file> <output_file>", file=sys.stderr)
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2]
    
    # Debug info
    print(f"Input file: {input_file}", file=sys.stderr)
    print(f"Output file: {output_file}", file=sys.stderr)
    
    # Check if input file exists
    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' does not exist", file=sys.stderr)
        sys.exit(1)
    
    # Read text from file
    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            text = f.read().strip()
    except Exception as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)
    
    if not text:
        print("Error: No text provided in file", file=sys.stderr)
        sys.exit(1)
    
    print(f"Text to speak ({len(text)} chars): {text[:100]}...", file=sys.stderr)
    
    # Edge TTS with British male voice (NEXUS-like)
    # Available British voices:
    # en-GB-RyanNeural, en-GB-ThomasNeural, en-GB-SoniaNeural
    # en-GB-LibbyNeural, en-GB-MaisieNeural, en-GB-OliverNeural
    voice = "en-GB-RyanNeural"
    
    try:
        # Create Communicate object with proper format
        # Rate: "+0%", "+10%", "-10%" etc.
        # Pitch: "+0Hz", "+5Hz", "-5Hz" etc.  
        # Volume: "+0%", "+10%", "-10%" etc.
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate="+10%",      # Faster speech (percentage format)
            pitch="-5Hz",     # Deeper pitch (Hz format)
            volume="+0%",     # Normal volume (percentage format)
        )
        
        print(f"Generating speech with voice: {voice}", file=sys.stderr)
        print(f"Rate: +10%, Pitch: -5Hz", file=sys.stderr)
        
        await communicate.save(output_file)
        print(f"Audio successfully saved to: {output_file}", file=sys.stderr)
        
        # Check if output file was created and has content
        if os.path.exists(output_file):
            size = os.path.getsize(output_file)
            print(f"Output file size: {size} bytes", file=sys.stderr)
            
            if size > 0:
                print("✅ Speech generation successful!", file=sys.stderr)
            else:
                print("❌ Output file is empty", file=sys.stderr)
                sys.exit(1)
        else:
            print("❌ Output file was not created", file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Error generating speech: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nInterrupted by user", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)
