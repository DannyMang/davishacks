import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const CAT_FRAMES = [
    `
    /\\___/\\
   (  o o  )
   (  =^=  ) ~
    (______)`,
    `
    /\\___/\\
   (  o o  )
   (  =^=  ) ~
    (______)`,
    `
    /\\___/\\
   (  o o  )
   (  =^=  ) ~
    (______)`,
    `
    /\\___/\\
   (  o o  )
   (  =^=  ) ~
    (______)`
];

const RUNNING_CAT = [
    `
    /\\___/\\
   (  o o  )
   (  =^=  ) ~
    (______)`,
    `
     /\\___/\\
    (  o o  )
   (  =^=  ) ~
    (______)`,
    `
      /\\___/\\
     (  o o  )
    (  =^=  ) ~
     (______)`,
    `
       /\\___/\\
      (  o o  )
     (  =^=  ) ~
      (______)`
];

interface LoadingCatProps {
    message?: string;
    isRunning?: boolean;
}

export const LoadingCat: React.FC<LoadingCatProps> = ({ 
    message = 'Loading...', 
    isRunning = true 
}) => {
    const [frameIndex, setFrameIndex] = useState(0);

    useEffect(() => {
        if (!isRunning) return;

        const interval = setInterval(() => {
            setFrameIndex((prev) => (prev + 1) % (isRunning ? RUNNING_CAT.length : CAT_FRAMES.length));
        }, 200);

        return () => clearInterval(interval);
    }, [isRunning]);

    return (
        <Box flexDirection="column" alignItems="center">
            <Text>{isRunning ? RUNNING_CAT[frameIndex] : CAT_FRAMES[frameIndex]}</Text>
            <Text>{message}</Text>
        </Box>
    );
}; 