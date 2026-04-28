import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";

const locatePlaceTool: FunctionDeclaration = {
  name: "locatePlace",
  parameters: {
    type: Type.OBJECT,
    description: "Locate a specific building, shop, landmark, or 'thing' on the map. Use this when the user asks to 'go to', 'find', or 'show' a single specific location. You are capable of finding the most remote locations and specific buildings.",
    properties: {
      placeName: {
        type: Type.STRING,
        description: "The name of the specific place or building to locate (e.g., 'Burj Khalifa', 'Apple Store', 'My House').",
      },
      lat: {
        type: Type.NUMBER,
        description: "The latitude of the place (optional, use if you can find exact coordinates via search).",
      },
      lng: {
        type: Type.NUMBER,
        description: "The longitude of the place (optional, use if you can find exact coordinates via search).",
      },
      reason: {
        type: Type.STRING,
        description: "A brief reason why this place is being located.",
      }
    },
    required: ["placeName"],
  },
};

const calculateRouteTool: FunctionDeclaration = {
  name: "calculateRoute",
  parameters: {
    type: Type.OBJECT,
    description: "Calculate and mark a tactical route between two locations on the map.",
    properties: {
      startPlace: {
        type: Type.STRING,
        description: "The starting location (e.g., 'New York', 'Current Position').",
      },
      startLat: {
        type: Type.NUMBER,
        description: "The latitude of the starting location (optional, use if you can find exact coordinates).",
      },
      startLng: {
        type: Type.NUMBER,
        description: "The longitude of the starting location (optional, use if you can find exact coordinates).",
      },
      endPlace: {
        type: Type.STRING,
        description: "The destination location (e.g., 'Los Angeles', 'Eiffel Tower').",
      },
      endLat: {
        type: Type.NUMBER,
        description: "The latitude of the destination (optional, use if you can find exact coordinates).",
      },
      endLng: {
        type: Type.NUMBER,
        description: "The longitude of the destination (optional, use if you can find exact coordinates).",
      },
      transportMode: {
        type: Type.STRING,
        description: "The mode of transport (driving, walking, cycling, railway, waterway, airway).",
        enum: ["driving", "walking", "cycling", "railway", "waterway", "airway"]
      }
    },
    required: ["startPlace", "endPlace"],
  },
};

const searchPlacesTool: FunctionDeclaration = {
  name: "searchPlaces",
  parameters: {
    type: Type.OBJECT,
    description: "Search for ANYTHING on the map, just like Google Maps. This includes specific buildings, shops, landmarks, businesses, or categories of places (like 'best pizza', 'ATM', 'park').",
    properties: {
      query: {
        type: Type.STRING,
        description: "The search query (e.g., 'Starbucks', 'Eiffel Tower', 'hospitals in London', 'grocery store').",
      },
      location: {
        type: Type.STRING,
        description: "The location to search in (e.g., 'Paris', 'New York', 'current view').",
      },
      lat: {
        type: Type.NUMBER,
        description: "The latitude of the search center (optional, use if you can find exact coordinates).",
      },
      lng: {
        type: Type.NUMBER,
        description: "The longitude of the search center (optional, use if you can find exact coordinates).",
      },
      type: {
        type: Type.STRING,
        description: "The specific type of place to search for (e.g., 'restaurant', 'hotel', 'museum').",
      }
    },
    required: ["query"],
  },
};

function getAI() {
  // The key is injected via vite.config.ts. 
  // We prioritize VITE_API_KEY (personal key) over the default platform key.
  const personalKey = import.meta.env.VITE_API_KEY;
  const platformKey = process.env.GEMINI_API_KEY;
  
  const key = personalKey || platformKey;
  
  if (!key) {
    console.error("AI Configuration Error: No API key found. Please ensure VITE_API_KEY is set in the Secrets panel.");
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  
  return new GoogleGenAI({ apiKey: key });
}

export async function analyzeTerrain(lat: number, lng: number) {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: `Tell me about the area and what it's like there at coordinates ${lat}, ${lng}. 
      Provide a simple, easy-to-read report (max 300 words) focusing on:
      1. What the land is like (cities, mountains, forests, etc.)
      2. Any natural risks people should know about (like floods or landslides)
      3. Why this place is interesting or important.
      
      Use your knowledge of global geography and real-time search capabilities if available.
      Explain things simply so anyone can understand. Use only English for all place names and descriptions.` }] }],
      tools: [{ googleSearch: {} }],
      config: {
        maxOutputTokens: 2048,
      },
    } as any);

    if (!response.text) {
      throw new Error("Empty response from AI");
    }

    return response.text;
  } catch (error: any) {
    console.error("AI Analysis failed:", error);
    const errorMsg = error?.message || String(error);
    // Fallback if search grounding fails
    try {
      const ai = getAI();
      const fallbackResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze the terrain at coordinates ${lat}, ${lng} based on your internal geographic knowledge. 
        Provide a brief tactical report (max 150 words) on terrain type and potential risks.`,
        config: {
          maxOutputTokens: 1024,
        },
      });
      return fallbackResponse.text || `ERROR: AI Intelligence link failed. (${errorMsg})`;
    } catch (fallbackError: any) {
      console.error("AI Fallback failed:", fallbackError);
      return `ERROR: AI Intelligence link failed. (${fallbackError?.message || errorMsg})`;
    }
  }
}

let lastIntelCallTime = 0;
const INTEL_COOLDOWN = 15000; // 15s cooldown for live intel

export async function getLiveIntel(location: string) {
  const now = Date.now();
  if (now - lastIntelCallTime < INTEL_COOLDOWN) {
    console.log("Live Intel call throttled to save quota.");
    return null; 
  }
  lastIntelCallTime = now;

  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: `Give me the latest news and updates for ${location}. 
      Focus on recent events, local news, or any natural disasters. 
      Format as a series of short, easy-to-read updates (max 400 words total).
      Use simple language and only English for all place names and descriptions.` }] }],
      tools: [{ googleSearch: {} }],
      config: {
        maxOutputTokens: 2048,
      },
    } as any);

    if (!response.text) {
      throw new Error("Empty response from AI");
    }

    return response.text;
  } catch (error: any) {
    console.error("Live Intel failed:", error);
    const errorMsg = error?.message || String(error);
    
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
      return "COMMUNICATION OVERLOAD: ASK SAGITTARIUS IS BUSY. Please wait 60 seconds or check your usage in Google AI Studio.";
    }
    
    try {
      const ai = getAI();
      const fallbackResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Provide a general tactical overview for ${location} based on your internal knowledge. 
        Focus on potential geographic or historical strategic points. Keep it concise (max 200 words).`,
        config: {
          maxOutputTokens: 1024,
        },
      });
      return fallbackResponse.text || `ERROR: Tactical data stream interrupted. (${errorMsg})`;
    } catch (fallbackError: any) {
      console.error("Live Intel Fallback failed:", fallbackError);
      return `ERROR: Tactical data stream interrupted. (${fallbackError?.message || errorMsg})`;
    }
  }
}

export async function describeRoute(start: [number, number], end: [number, number], distance: number, duration: number, mode: string = 'driving') {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Give me a simple travel guide for a route from ${start[0]}, ${start[1]} to ${end[0]}, ${end[1]}.
      Distance: ${(distance / 1000).toFixed(2)}km.
      Estimated Time: ${Math.round(duration / 60)} minutes.
      Mode of Transport: ${mode}.
      
      Provide a brief, friendly summary of the trip (max 200 words). 
      - If the mode is 'railway', 'waterway', or 'airway', check if these services are actually possible between these locations.
      - Mention what the journey will be like and what to expect. 
      - Provide a rough ESTIMATED COST for this trip (e.g., tickets, fuel, or fares).
      - **CRITICAL**: At the end of the pricing section, provide a "TOTAL ESTIMATED COST" summary line.
      
      Explain things simply in English.`,
      config: {
        maxOutputTokens: 1024,
      },
    });

    return response.text;
  } catch (error: any) {
    console.error("Route description failed:", error);
    return `Tactical route briefing unavailable. (${error?.message || String(error)})`;
  }
}

export async function chatWithAI(message: string, context: any) {
  try {
    const ai = getAI();
    const prompt = `You are Ask Sagittarius, a friendly and helpful travel and map assistant. 
      You explain things simply and clearly so that everyone can easily understand.
      
      Capabilities:
      1. Move the map & globe: If the user asks to "show me", "locate", "go to", or "find" a specific landmark, building, street, or city, use the 'locatePlace' tool. 
         - **GLOBE INTEGRATION**: This tool works for both the 2D Map and the 3D Globe. When used, the system will rotate the globe and zoom in precisely on the target.
          - **CRITICAL**: For specific buildings, landmarks, or "things", you MUST use Google Search to find the exact latitude and longitude coordinates first. Then, provide these coordinates in the 'lat' and 'lng' parameters of the 'locatePlace' tool. This is the only way to ensure the map and globe center exactly on the building.
          - **REMOTE LOCATIONS**: You are trained to find the most remote locations and specific buildings. Use your search capabilities to find coordinates for even the most obscure places.
          - If you cannot find exact coordinates, provide the most specific place name possible.
      2. Search for places: If the user asks for "restaurants", "hotels", "hospitals", "cafes", or "places to visit", use the 'searchPlaces' tool. You can search for ANYTHING, just like Google Maps.
      3. Mark a route: If the user asks for directions or how to get somewhere, use the 'calculateRoute' tool.
         - **PRO TIP**: Use Google Search to find exact coordinates for the start and end points if they are specific buildings or landmarks, and provide them in the tool.
      4. Tell me about the area: You can explain what a place is like using your knowledge and Google Search.
      5. Travel & Cost Info: If the user asks about travel costs or transport options, provide simple estimates.
         - **CURRENCY RULE**: You MUST provide all travel cost estimates in the **LOCAL CURRENCY** of the destination country (e.g., INR for India, EUR for France, JPY for Japan). Do not use USD unless the destination is in the USA.
      6. Selected Place Info: If a place is selected, you can answer questions about its history, what to do there, or tips for visitors.
      
      **SEARCH STRATEGY**:
      - If the user asks for a specific building or place, ALWAYS use Google Search first to get the exact location details.
      - If the user asks for "routes" or "places", use the corresponding tools.
      - If the search bar or AI seems "unable to locate", it's because you didn't provide exact coordinates. DO NOT FAIL. Use your search tool to find them.
      
      When asked about restaurants or specific places:
      - Use Google Search to find the latest info (ratings, reviews, hours, what's good there).
      - Provide a simple summary for the top results.
      - Include info like: **Type of Food**, **Price** (in local currency), **Rating**, and **Why it's good**.
      - If searching for restaurants, always use the 'searchPlaces' tool to show them on the map.
      
      How to respond:
      - Use simple, human language. Avoid technical jargon.
      - Use clear Markdown with headers (###).
      - Use bold (**) for important things like prices or names.
      - Use bullet points for lists.
      - **CRITICAL**: Always include a "TOTAL ESTIMATED COST" summary in the **LOCAL CURRENCY** if you talk about prices.
      - Keep your answers helpful but short (max 500 words).
      
      Current Context: ${JSON.stringify(context)}
      User Message: ${message}
      
      When talking about routes:
      - Mention how they are traveling: ${context.transportMode}.
      - Give a realistic guess for costs like tickets or fuel.
      - If a travel mode isn't possible (like taking a boat in the desert), kindly explain why.
      
      Be helpful, friendly, and clear. Answer in English.`;

    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [
          { googleSearch: {} },
          { functionDeclarations: [locatePlaceTool, calculateRouteTool, searchPlacesTool] }
        ],
        toolConfig: { includeServerSideToolInvocations: true },
        config: {
          maxOutputTokens: 4096,
        },
      } as any);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        console.warn("Search quota exceeded for chat, falling back to basic AI chat.");
        response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt + "\n\n(Note: Search tools are currently unavailable due to quota limits. I will provide information based on my internal knowledge.)",
          config: {
            tools: [
              { functionDeclarations: [locatePlaceTool, calculateRouteTool, searchPlacesTool] }
            ],
            maxOutputTokens: 4096,
          },
        });
      } else {
        throw error;
      }
    }

    const functionCalls = response.functionCalls;
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      if (call.name === "locatePlace") {
        return {
          text: response.text || `Understood. Locating ${call.args.placeName} on the tactical map...`,
          locationRequest: call.args.placeName as string,
          lat: call.args.lat as number,
          lng: call.args.lng as number
        };
      } else if (call.name === "calculateRoute") {
        return {
          text: response.text || `Tactical route requested from ${call.args.startPlace} to ${call.args.endPlace} via ${call.args.transportMode || context.transportMode}. Initializing navigation share...`,
          routeRequest: {
            start: call.args.startPlace as string,
            startLat: call.args.startLat as number,
            startLng: call.args.startLng as number,
            end: call.args.endPlace as string,
            endLat: call.args.endLat as number,
            endLng: call.args.endLng as number,
            mode: (call.args.transportMode as string) || (context.transportMode as string)
          }
        };
      } else if (call.name === "searchPlaces") {
        return {
          text: response.text || `Initiating reconnaissance for ${call.args.query}${call.args.location ? ` in ${call.args.location}` : ''}. Scanning for tactical points of interest...`,
          searchRequest: {
            query: call.args.query as string,
            location: call.args.location as string,
            lat: call.args.lat as number,
            lng: call.args.lng as number,
            type: call.args.type as string
          }
        };
      }
    }

    return { text: response.text || "I have processed your request, but I don't have a specific verbal response. The map should be updated accordingly." };
  } catch (error: any) {
    console.error("AI Chat failed detailed error:", error);
    if (error.message === "GEMINI_API_KEY_MISSING") {
      return { text: "System Error: AI credentials missing. Please ensure VITE_API_KEY is set in the Secrets panel." };
    }
    
    const errorMsg = error?.message || String(error);
    let errorMessage = `Tactical communication link unstable. (${errorMsg})`;
    
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
      errorMessage = "COMMUNICATION OVERLOAD: ASK SAGITTARIUS IS BUSY. Please wait 60 seconds or check your usage in Google AI Studio. Tip: Close extra tabs to save resources.";
    } else if (errorMsg.includes("API_KEY_INVALID")) {
      errorMessage = "Error: The API Key provided is invalid. Please check your Secrets panel and ensure there are no extra spaces.";
    } else if (errorMsg.includes("model not found")) {
      errorMessage = "Error: The AI model is currently unavailable for this key.";
    } else if (errorMsg.includes("User location is not supported")) {
      errorMessage = "Error: Gemini API is not supported in your current region.";
    }
    
    return { text: errorMessage };
  }
}

export async function getPlaceInfo(placeName: string, placeDetails: any) {
  try {
    const ai = getAI();
    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Tell me about this place and what people should know when visiting:
        Name: ${placeName}
        Details: ${JSON.stringify(placeDetails)}
        
        Focus on:
        1. What makes this place special or interesting.
        2. Tips for visitors (best time to go, what to see, what's available).
        3. For Hotels: Mention the rooms, roughly how much it costs, and what the vibe is like.
        4. For Landmarks: Mention why it's famous and what not to miss.
        
        Explain things simply and clearly in Markdown (max 400 words). 
        Use bold (**) for key info and headers (###) for sections.
        Always respond in English.` }] }],
        tools: [{ googleSearch: {} }],
        config: {
          maxOutputTokens: 2048,
        },
      } as any);
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
        console.warn("Search quota exceeded for place info, falling back to internal knowledge.");
        response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Provide a tactical intelligence briefing and visitor information for ${placeName} based on your internal knowledge.
          Details: ${JSON.stringify(placeDetails)}
          Format as a professional intelligence report in Markdown (max 400 words).`,
          config: {
            maxOutputTokens: 2048,
          },
        });
      } else {
        throw error;
      }
    }

    return response.text;
  } catch (error: any) {
    console.error("Place info failed:", error);
    return `Tactical briefing for ${placeName} unavailable. (${error?.message || String(error)})`;
  }
}
