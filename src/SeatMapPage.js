import React, { useState, useEffect } from "react";
import { db } from "./firebaseConfig";
import { collection, query, getDocs, onSnapshot } from "firebase/firestore";
import "./ConfirmationPage.css"; // Reusing same styles

const familyColors = [
  "#FF9AA2", // Soft red
  "#FFB7B2", // Salmon
  "#FFDAC1", // Peach
  "#E2F0CB", // Light green
  "#B5EAD7", // Mint
  "#C7CEEA", // Light blue
  "#9BB7D4", // Steel blue
  "#B5B9FF", // Lavender
  "#DCD3FF", // Light purple
  "#F7D794"  // Light yellow
];

const generateSeatLabels = () => {
  const rows = 20;
  const cols = ["A", "B", "C", "D", "E", "F"];
  const seats = [];
  let seatNumber = 1;

  for (let i = 1; i <= rows; i++) {
    cols.forEach((col) => {
      seats.push({ 
        row: i, 
        col: col,
        label: `${i}${col}`,
        seatNumber: seatNumber++,
        isNearToilet: i <= 4 || i >= 17, // First 4 and last 4 rows near washrooms
        isBackWashroom: i >= 17, // Specifically at back washrooms
        isFrontWashroom: i <= 4, // Specifically at front washrooms
        isEmergencyExit: i === 11, // Emergency exit row
        isAisle: col === "C" || col === "D", // Aisle seats
        seatType: col === "A" || col === "F" ? "window" : col === "C" || col === "D" ? "aisle" : "middle"
      });
    });
  }
  return seats;
};

const InfoBox = () => (
  <div className="algorithm-info-box">
    <h3>🎯 Seat Allocation Priority System</h3>
    <div className="priority-list">
      <div className="priority-item">
        <span className="priority-number">1</span>
        <div className="priority-content">
          <h4>♿ Disabled Passengers</h4>
          <p>Priority seating near washrooms</p>
        </div>
      </div>
      <div className="priority-item">
        <span className="priority-number">2</span>
        <div className="priority-content">
          <h4>👨‍👩‍👧‍👦 Family Seating</h4>
          <p>Families stay together:</p>
          <ul>
            <li>Groups of 3 or less: Same row</li>
            <li>Groups larger than 3: First 3 members in front row, others directly behind</li>
          </ul>
        </div>
      </div>
      <div className="priority-item">
        <span className="priority-number">3</span>
        <div className="priority-content">
          <h4>👤 Solo Travelers</h4>
          <p>Preferential seating near emergency exits (Row 11)</p>
        </div>
      </div>
    </div>
  </div>
);

const SeatMapPage = ({ passengerData, travelType }) => {
  const [allPassengers, setAllPassengers] = useState([]);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const seatLabels = generateSeatLabels();

  // Helper function to check if passenger is young (under 30)
  const isYoungPassenger = (passenger) => {
    const age = parseInt(passenger.age);
    return !isNaN(age) && age >= 18 && age < 30; // Must be between 18-30 for emergency exit rows
  };

  // Helper function to find best seats for disabled passengers
  const findNearestToiletSeat = (availableSeats, preferBack = false) => {
    // Sort toilet-adjacent seats by row to prioritize front and back rows
    const toiletSeats = availableSeats
      .filter(seat => seat.isNearToilet)
      .sort((a, b) => {
        if (preferBack) {
          // Prioritize back washroom first, then front
          if (a.isBackWashroom && !b.isBackWashroom) return -1;
          if (!a.isBackWashroom && b.isBackWashroom) return 1;
        }
        
        // Then prioritize rows closest to washrooms
        const aDistance = Math.min(a.row, Math.abs(a.row - 20));
        const bDistance = Math.min(b.row, Math.abs(b.row - 20));
        return aDistance - bDistance;
      });
    
    // Prioritize aisle seats for disabled passengers
    const aisleToiletSeat = toiletSeats.find(seat => seat.isAisle);
    return aisleToiletSeat || toiletSeats[0] || availableSeats[0]; // Fallback to any seat if needed
  };

  // Helper function to find consecutive seats in a row
  const findConsecutiveSeats = (row, count, availableSeats) => {
    // Get all seats in the specified row
    const seatsInRow = availableSeats.filter(seat => seat.row === row);
    
    // Try to find seats on one side of aisle first (seats 1,2,3 or 4,5,6)
    const leftSide = seatsInRow.filter(seat => ["A", "B", "C"].includes(seat.col));
    const rightSide = seatsInRow.filter(seat => ["D", "E", "F"].includes(seat.col));

    if (count <= 3) {
      // Try left side first
      if (leftSide.length >= count) return leftSide.slice(0, count);
      // Try right side if left side doesn't have enough seats
      if (rightSide.length >= count) return rightSide.slice(0, count);
    }

    return [];
  };

  // Helper function to find vertical cluster seats for a family
  const findFamilyClusterSeats = (familySize, availableSeats) => {
    const neededRows = Math.ceil(familySize / 3);
    
    // Define the two possible seating patterns
    const sidePatterns = [
      {
        cols: ["A", "B", "C"],
        baseNumber: 1, // Seats will be 1,2,3,7,8,9,13,14,15...
        name: "left"
      },
      {
        cols: ["D", "E", "F"],
        baseNumber: 4, // Seats will be 4,5,6,10,11,12,16,17,18...
        name: "right"
      }
    ];

    // Try each side pattern with maximum flexibility for larger families
    for (const pattern of sidePatterns) {
      // For larger families, try more row combinations
      const maxRow = 20 - neededRows + 1;
      const startRows = [];
      
      // Generate starting rows - prioritize middle rows for families WITHOUT disabilities
      for (let i = 1; i <= maxRow; i++) {
        // Skip if the range includes emergency exit row (row 11)
        if (i <= 11 && i + neededRows > 11) continue;
        
        // Skip if near washrooms (non-disabled families should NOT be near washrooms)
        if (i <= 4 || i + neededRows > 17) continue;
        
        startRows.push(i);
      }
      
      // If no valid non-washroom rows, try all possible rows as a fallback
      if (startRows.length === 0) {
        for (let i = 1; i <= maxRow; i++) {
          if (i <= 11 && i + neededRows > 11) continue; // Still skip emergency exit
          startRows.push(i);
        }
      }
      
      // Sort start rows by preference (prioritize middle section, away from toilets)
      startRows.sort((a, b) => {
        // Calculate distance from washroom areas
        const aDistFromWashroom = Math.min(Math.abs(a - 2.5), Math.abs(a - 18.5));
        const bDistFromWashroom = Math.min(Math.abs(b - 2.5), Math.abs(b - 18.5));
        return bDistFromWashroom - aDistFromWashroom; // Larger distance from washroom is better
      });
      
      // Try each possible starting row
      for (const startRow of startRows) {
        const potentialSeats = [];
        let hasEnoughSeats = true;

        // Check each row we need
        for (let rowOffset = 0; rowOffset < neededRows; rowOffset++) {
          const currentRow = startRow + rowOffset;
          
          // Get available seats in this row on the current side
          const seatsInRow = availableSeats.filter(seat => 
            seat.row === currentRow && 
            pattern.cols.includes(seat.col)
          ).sort((a, b) => 
            pattern.cols.indexOf(a.col) - pattern.cols.indexOf(b.col)
          );

          // Need either 3 seats or remaining seats for last row
          const neededInThisRow = Math.min(3, familySize - (rowOffset * 3));
          
          if (seatsInRow.length < neededInThisRow) {
            hasEnoughSeats = false;
            break;
          }

          // Add the seats we need from this row
          potentialSeats.push(...seatsInRow.slice(0, neededInThisRow));
        }

        if (hasEnoughSeats && potentialSeats.length === familySize) {
          return {
            seats: potentialSeats,
            side: pattern.name
          };
        }
      }
    }

    // If vertical pattern fails, try to find any consecutive seats as a fallback
    console.log(`Could not find vertical pattern for family of ${familySize}. Trying to find any available seats.`);
    const allAvailableSeats = availableSeats.slice(0, familySize);
    
    if (allAvailableSeats.length === familySize) {
      return {
        seats: allAvailableSeats,
        side: null
      };
    }

    return { seats: [], side: null };
  };

  // Helper function to find seats near toilet for a group
  const findGroupToiletSeats = (familySize, availableSeats, isStrictlyNearWashroom = true) => {
    const neededRows = Math.ceil(familySize / 3);
    // Define toilet rows strictly - must be near washrooms (rows 1-4 and 17-20)
    const toiletRows = [1, 2, 3, 18, 19, 20]; 
    
    // Use the same patterns as regular family seating
    const sidePatterns = [
      {
        cols: ["A", "B", "C"],
        baseNumber: 1,
        name: "left"
      },
      {
        cols: ["D", "E", "F"],
        baseNumber: 4,
        name: "right"
      }
    ];
    
    // Check if we can fit the whole family in one toilet area section (front or back)
    // Try back washroom first, then front washroom
    const backToiletRows = [20, 19, 18];
    const frontToiletRows = [1, 2,3, ];
    
    // Try to find consecutive rows in EACH side of the plane for the entire family
    for (const pattern of sidePatterns) {
      // Try back section first, then front section (prioritize back washroom)
      const sectionsToTry = [backToiletRows, frontToiletRows];
      
      for (const section of sectionsToTry) {
        if (section.length >= neededRows) {
          // Check if we have enough consecutive seats on this side in these rows
          const potentialSeats = [];
          let hasEnoughSeats = true;
          
          for (let rowIndex = 0; rowIndex < neededRows; rowIndex++) {
            if (rowIndex >= section.length) {
              hasEnoughSeats = false;
              break;
            }
            
            const currentRow = section[rowIndex];
            const seatsInRow = availableSeats.filter(seat => 
              seat.row === currentRow && 
              pattern.cols.includes(seat.col)
            ).sort((a, b) => 
              pattern.cols.indexOf(a.col) - pattern.cols.indexOf(b.col)
            );
            
            const neededInThisRow = Math.min(3, familySize - (rowIndex * 3));
            if (seatsInRow.length < neededInThisRow) {
              hasEnoughSeats = false;
              break;
            }
            
            potentialSeats.push(...seatsInRow.slice(0, neededInThisRow));
          }
          
          if (hasEnoughSeats && potentialSeats.length === familySize) {
            return {
              seats: potentialSeats,
              side: pattern.name
            };
          }
        }
      }
    }

    // If we couldn't fit the whole family in one section, try to find any combination
    // of toilet-adjacent seats that can fit the family (might span front and back)
    if (isStrictlyNearWashroom) {
      // Get all possible washroom-area seats
      const allWashroomSeats = availableSeats.filter(seat => 
        toiletRows.includes(seat.row)
      );
      
      // Prioritize back washroom seats first
      const backWashroomSeats = allWashroomSeats.filter(seat => seat.isBackWashroom);
      const frontWashroomSeats = allWashroomSeats.filter(seat => seat.isFrontWashroom);
      
      // Try to find a set of seats that can accommodate the family
      // First try the back washroom area
      for (const seatSet of [backWashroomSeats, frontWashroomSeats]) {
        // Group by side (A,B,C or D,E,F)
        const leftSideSeats = seatSet.filter(seat => ["A", "B", "C"].includes(seat.col))
          .sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));
        const rightSideSeats = seatSet.filter(seat => ["D", "E", "F"].includes(seat.col))
          .sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));
        
        // Check if either side has enough seats
        if (leftSideSeats.length >= familySize) {
          return {
            seats: leftSideSeats.slice(0, familySize),
            side: "left"
          };
        }
        
        if (rightSideSeats.length >= familySize) {
          return {
            seats: rightSideSeats.slice(0, familySize),
            side: "right"
          };
        }
      }
      
      // If neither individual section has enough seats, combine both washroom areas
      // Prioritize keeping family on the same side
      const leftSideSeats = allWashroomSeats.filter(seat => ["A", "B", "C"].includes(seat.col))
        .sort((a, b) => (a.isBackWashroom ? -1 : 1) - (b.isBackWashroom ? -1 : 1) || a.row - b.row || a.col.localeCompare(b.col));
      const rightSideSeats = allWashroomSeats.filter(seat => ["D", "E", "F"].includes(seat.col))
        .sort((a, b) => (a.isBackWashroom ? -1 : 1) - (b.isBackWashroom ? -1 : 1) || a.row - b.row || a.col.localeCompare(b.col));
      
      if (leftSideSeats.length >= familySize) {
        return {
          seats: leftSideSeats.slice(0, familySize),
          side: "left"
        };
      }
      
      if (rightSideSeats.length >= familySize) {
        return {
          seats: rightSideSeats.slice(0, familySize),
          side: "right"
        };
      }
      
      // If we still don't have enough seats on one side, combine all washroom seats
      if (allWashroomSeats.length >= familySize) {
        return {
          seats: allWashroomSeats
            .sort((a, b) => (a.isBackWashroom ? -1 : 1) - (b.isBackWashroom ? -1 : 1)) // Prioritize back washroom
            .slice(0, familySize),
          side: null
        };
      }
    }

    return { seats: [], side: null };
  };

  // Main seat allocation algorithm
  const allocateSeats = (passengers) => {
    if (!Array.isArray(passengers) || passengers.length === 0) {
      console.error('No valid passenger data provided');
      return new Array(seatLabels.length).fill(null);
    }

    let availableSeats = [...seatLabels];
    const allocatedSeats = new Array(seatLabels.length).fill(null);
    const allocatedPassengers = new Set();
    let familyColorIndex = 0;
    
    // Filter out any invalid passenger entries
    const validPassengers = passengers.filter(p => p && typeof p === 'object' && p.name);

    // Sort passengers by timestamp to maintain booking order
    const sortedPassengers = [...validPassengers].sort((a, b) => 
      ((a?.timestamp || 0) - (b?.timestamp || 0))
    );

    // 1. First identify all DISABLED passengers (in families or solo)
    const disabledPassengers = new Set();
    sortedPassengers.forEach(passenger => {
      if (passenger?.disability === "Yes") {
        disabledPassengers.add(passenger.name);
      }
    });

    // 2. Group families by booking and identify disabled family members
    const familyGroups = new Map();
    
    sortedPassengers.forEach(passenger => {
      if (passenger?.travelType === "family") {
        const bookingKey = passenger.bookingId || passenger.timestamp || Date.now();
        if (!familyGroups.has(bookingKey)) {
          familyGroups.set(bookingKey, {
            members: [],
            color: familyColors[familyColorIndex % familyColors.length],
            id: `family-${familyColorIndex + 1}`,
            hasDisabledMember: false,
            disabledCount: 0
          });
          familyColorIndex++;
        }
        familyGroups.get(bookingKey).members.push(passenger);
        
        // Check if this passenger is disabled
        if (passenger?.disability === "Yes") {
          familyGroups.get(bookingKey).hasDisabledMember = true;
          familyGroups.get(bookingKey).disabledCount++;
        }
      }
    });

    // IMPORTANT: Sort families by priority
    // 1. Disabled families first (with higher priority for those with more disabled members)
    // 2. Larger families before smaller ones (harder to place)
    const familyEntries = Array.from(familyGroups.entries());
    familyEntries.sort((a, b) => {
      const aFamily = a[1];
      const bFamily = b[1];
      
      // First priority: families with disabled members
      if (aFamily.hasDisabledMember && !bFamily.hasDisabledMember) return -1;
      if (!aFamily.hasDisabledMember && bFamily.hasDisabledMember) return 1;
      
      // Second priority: families with more disabled members
      if (aFamily.disabledCount !== bFamily.disabledCount) {
        return bFamily.disabledCount - aFamily.disabledCount; 
      }
      
      // Third priority: larger families first (harder to place)
      return bFamily.members.length - aFamily.members.length;
    });

    // Reserve washroom area seats for disabled passengers
    let washroomAreaSeats = availableSeats.filter(seat => seat.isNearToilet);
    let nonWashroomAreaSeats = availableSeats.filter(seat => !seat.isNearToilet);
    
    // 3. Process families first (keeping them together)
    for (const [_, family] of familyEntries) {
      const { members, color, id, hasDisabledMember } = family;
      if (!members.length) continue;
      
      console.log(`Processing family with ${members.length} members, disabled: ${hasDisabledMember}`);
      
      let result = { seats: [], side: null };
      
      if (hasDisabledMember) {
        // STEP 1: Try to fit the family in washroom-adjacent seats
        result = findGroupToiletSeats(members.length, availableSeats, true);
        
        // STEP 2: If that doesn't work, try a more aggressive approach by relocating solo passengers
        if (!result.seats.length) {
          // Identify solo passengers already allocated in washroom areas who could be moved
          const soloPassengersInWashroomArea = [];
          
          for (let i = 0; i < allocatedSeats.length; i++) {
            const passenger = allocatedSeats[i];
            if (passenger && passenger.travelType === "solo" && !disabledPassengers.has(passenger.name)) {
              // Check if this seat is near a washroom
              const seat = seatLabels[i];
              if (seat && seat.isNearToilet) {
                soloPassengersInWashroomArea.push({
                  passenger,
                  seatIndex: i,
                  seat
                });
              }
            }
          }
          
          // If we found relocatable passengers, free up their seats
          if (soloPassengersInWashroomArea.length > 0) {
            console.log(`Found ${soloPassengersInWashroomArea.length} solo passengers in washroom area who could be moved`);
            
            // Sort by seat number to keep them roughly together
            soloPassengersInWashroomArea.sort((a, b) => a.seat.seatNumber - b.seat.seatNumber);
            
            // Determine how many we need to move
            const solosToMove = Math.min(members.length, soloPassengersInWashroomArea.length);
            const passengersToMove = soloPassengersInWashroomArea.slice(0, solosToMove);
            
            // Temporarily remove these passengers and add their seats back to available
            passengersToMove.forEach(({ passenger, seatIndex, seat }) => {
              allocatedSeats[seatIndex] = null;
              allocatedPassengers.delete(passenger.name);
              availableSeats.push(seat);
              washroomAreaSeats.push(seat);
            });
            
            // Try again to allocate the family
            result = findGroupToiletSeats(members.length, availableSeats, true);
            
            // If we succeeded, put the displaced solos in the general seating area
            if (result.seats.length === members.length) {
              console.log(`Successfully relocated family after moving ${solosToMove} solo passengers`);
            } else {
              // Put the solos back where they were
              passengersToMove.forEach(({ passenger, seatIndex }) => {
                allocatedSeats[seatIndex] = passenger;
                allocatedPassengers.add(passenger.name);
              });
              availableSeats = availableSeats.filter(seat => 
                !passengersToMove.some(p => p.seat.label === seat.label)
              );
              washroomAreaSeats = washroomAreaSeats.filter(seat => 
                !passengersToMove.some(p => p.seat.label === seat.label)
              );
            }
          }
        }
        
        // STEP 3: As a last resort, allow seats that aren't strictly near washrooms
        if (!result.seats.length) {
          console.warn(`Could not allocate washroom seats for disabled family. Using any available seats.`);
          result = findGroupToiletSeats(members.length, availableSeats, false);
          
          // Try one last approach - anything that keeps the family together
          if (!result.seats.length && availableSeats.length >= members.length) {
            // Last resort - take any consecutive seats we can find
            // Ideally on the same side of the plane for convenience
            const leftSideSeats = availableSeats.filter(seat => ["A", "B", "C"].includes(seat.col))
              .sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));
            const rightSideSeats = availableSeats.filter(seat => ["D", "E", "F"].includes(seat.col))
              .sort((a, b) => a.row - b.row || a.col.localeCompare(b.col));
            
            // Use whichever side has enough seats
            if (leftSideSeats.length >= members.length) {
              result = {
                seats: leftSideSeats.slice(0, members.length),
                side: "left"
              };
            } else if (rightSideSeats.length >= members.length) {
              result = {
                seats: rightSideSeats.slice(0, members.length),
                side: "right"
              };
            } else {
              // Absolute last resort - any seats
              result = {
                seats: availableSeats.slice(0, members.length),
                side: null
              };
            }
          }
        }
      } else {
        // For non-disabled families, keep them away from washroom areas
        result = findFamilyClusterSeats(members.length, nonWashroomAreaSeats);
        
        if (!result.seats.length) {
          // Fall back to any available seats if needed
          result = findFamilyClusterSeats(members.length, availableSeats);
          
          // Last resort - any seats that keep the family together
          if (!result.seats.length && availableSeats.length >= members.length) {
            result = {
              seats: availableSeats.slice(0, members.length),
              side: null
            };
          }
        }
      }

      // Allocate the seats to the family
      if (result.seats.length === members.length) {
        result.seats.forEach((seat, index) => {
          const passenger = members[index];
          if (!passenger || allocatedPassengers.has(passenger.name)) return;

          const seatIndex = seatLabels.findIndex(s => s.label === seat.label);
          if (seatIndex === -1) return;

          allocatedSeats[seatIndex] = {
            ...passenger,
            seatLabel: seat.label,
            seatNumber: seat.seatNumber,
            familyColor: color,
            familyId: id
          };

          allocatedPassengers.add(passenger.name);
          
          // Remove seat from available pools
          availableSeats = availableSeats.filter(s => s.label !== seat.label);
          washroomAreaSeats = washroomAreaSeats.filter(s => s.label !== seat.label);
          nonWashroomAreaSeats = nonWashroomAreaSeats.filter(s => s.label !== seat.label);
        });
        
        console.log(`Successfully allocated ${result.seats.length} seats for family with ${members.length} members`);
      } else {
        console.warn(`Failed to allocate seats for family with ${members.length} members (disabled: ${hasDisabledMember})`);
      }
    }

    // Store displaced solo passengers that need to be reallocated
    const displacedSolos = [];
    
    // 4. Handle solo disabled passengers (near washrooms)
    const disabledSolos = sortedPassengers.filter(p => 
      p?.disability === "Yes" && 
      p?.travelType === "solo" &&
      !allocatedPassengers.has(p.name)
    );

    disabledSolos.forEach(passenger => {
      // Try to find seats in washroom area first, prioritizing back washroom
      const nearToiletSeat = washroomAreaSeats.length > 0
        ? findNearestToiletSeat(washroomAreaSeats, true) // true = prefer back washroom
        : findNearestToiletSeat(availableSeats, true); // Fallback to any seat

      if (nearToiletSeat) {
        const seatIndex = seatLabels.findIndex(s => s.label === nearToiletSeat.label);
        if (seatIndex !== -1) {
          allocatedSeats[seatIndex] = {
            ...passenger,
            seatLabel: nearToiletSeat.label,
            seatNumber: nearToiletSeat.seatNumber
          };
          allocatedPassengers.add(passenger.name);
          
          // Remove seat from all available seat lists
          availableSeats = availableSeats.filter(s => s.label !== nearToiletSeat.label);
          washroomAreaSeats = washroomAreaSeats.filter(s => s.label !== nearToiletSeat.label);
          nonWashroomAreaSeats = nonWashroomAreaSeats.filter(s => s.label !== nearToiletSeat.label);
          
          console.log(`Disabled passenger ${passenger.name} allocated seat ${nearToiletSeat.label} (near toilet: ${nearToiletSeat.isNearToilet}, back washroom: ${nearToiletSeat.isBackWashroom})`);
        }
      } else {
        console.error(`Failed to allocate seat for disabled passenger ${passenger.name}`);
      }
    });

    // 5. Handle young solo travelers (emergency exit row)
    const youngSolos = sortedPassengers.filter(p => 
      p?.travelType === "solo" && 
      isYoungPassenger(p) && 
      !allocatedPassengers.has(p.name) &&
      !displacedSolos.some(d => d.name === p.name)
    );

    const emergencyRowSeats = availableSeats.filter(seat => seat.isEmergencyExit);
    youngSolos.forEach(passenger => {
      if (emergencyRowSeats.length > 0) {
        const emergencyExitSeat = emergencyRowSeats.shift();
        const seatIndex = seatLabels.findIndex(s => s.label === emergencyExitSeat.label);
        allocatedSeats[seatIndex] = {
          ...passenger,
          seatLabel: emergencyExitSeat.label,
          seatNumber: emergencyExitSeat.seatNumber
        };
        allocatedPassengers.add(passenger.name);
        
        // Remove seat from all available seat lists
        availableSeats = availableSeats.filter(s => s.label !== emergencyExitSeat.label);
        washroomAreaSeats = washroomAreaSeats.filter(s => s.label !== emergencyExitSeat.label);
        nonWashroomAreaSeats = nonWashroomAreaSeats.filter(s => s.label !== emergencyExitSeat.label);
      } else {
        // Add to displaced solos if no emergency exit seats available
        displacedSolos.push(passenger);
      }
    });

    // 6. Handle remaining solo passengers and any displaced solos (they are fillers)
    const remainingSolos = [
      ...displacedSolos,
      ...sortedPassengers.filter(p => 
        !allocatedPassengers.has(p.name) && 
        p?.travelType === "solo" &&
        !displacedSolos.some(d => d.name === p.name)
      )
    ];

    remainingSolos.forEach(passenger => {
      // For regular passengers, prioritize NON-washroom seats
      let seat = null;
      
      if (nonWashroomAreaSeats.length > 0) {
        // Use non-washroom seats first for regular passengers
        seat = nonWashroomAreaSeats[0];
      } else if (availableSeats.length > 0) {
        // Fall back to any available seat
        seat = availableSeats[0];
      }
      
      if (seat) {
        const seatIndex = seatLabels.findIndex(s => s.label === seat.label);
        allocatedSeats[seatIndex] = {
          ...passenger,
          seatLabel: seat.label,
          seatNumber: seat.seatNumber
        };
        allocatedPassengers.add(passenger.name);
        
        // Remove seat from all available seat lists
        availableSeats = availableSeats.filter(s => s.label !== seat.label);
        washroomAreaSeats = washroomAreaSeats.filter(s => s.label !== seat.label);
        nonWashroomAreaSeats = nonWashroomAreaSeats.filter(s => s.label !== seat.label);
      }
    });

    return allocatedSeats;
  };

  useEffect(() => {
    let isMounted = true;

    const fetchPassengers = async () => {
      try {
        // Clear existing passengers first
        if (isMounted) {
          setAllPassengers([]);
        }

        const q = query(collection(db, "passengerData"));
        const querySnapshot = await getDocs(q);
        const passengers = [];
        const processedBookings = new Set(); // Track processed booking IDs
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          // Skip if this booking has no passengers array or is empty
          if (!data || !data.passengers || !Array.isArray(data.passengers) || data.passengers.length === 0) {
            return;
          }

          // Add valid passengers only
          data.passengers.forEach((passenger) => {
            if (passenger && passenger.name) { // Basic validation
              passengers.push({
                ...passenger,
                travelType: data.travelType || "solo",
                timestamp: data.timestamp || Date.now(),
                bookingId: doc.id,
                lastUpdated: Date.now() // Add timestamp for tracking freshness
              });
            }
          });
          processedBookings.add(doc.id);
        });

        console.log(`Fetched ${passengers.length} passengers from ${processedBookings.size} bookings`);
        
        // Sort by timestamp to maintain booking order
        passengers.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        
        if (isMounted) {
          setAllPassengers(passengers);
          setLastFetchTime(Date.now());
        }
      } catch (error) {
        console.error("Error fetching passenger data:", error);
      }
    };

    fetchPassengers();
    
    // Set up real-time listener for changes
    const unsubscribe = onSnapshot(collection(db, "passengerData"), (snapshot) => {
      if (snapshot.docChanges().length > 0) {
        console.log("Firebase data changed, refreshing...");
        if (isMounted) {
          fetchPassengers(); // Refresh data when changes occur
        }
      }
    }, (error) => {
      console.error("Firebase snapshot error:", error);
    });

    // Cleanup function
    return () => {
      isMounted = false;
      unsubscribe(); // Remove the listener
    };
  }, []);

  // Apply the seat allocation algorithm with proper error handling
  const assignedSeats = React.useMemo(() => {
    try {
      // Make sure both arrays exist before combining
      const localPassengers = allPassengers || [];
      const propsPassengers = passengerData || [];
      
      // Filter out any duplicates based on name
      const combinedPassengers = [...localPassengers];
      
      // Only add passengers from props if they don't already exist
      propsPassengers.forEach(passenger => {
        if (passenger && passenger.name) {
          const isDuplicate = combinedPassengers.some(p => p?.name === passenger.name);
          if (!isDuplicate) {
            combinedPassengers.push(passenger);
          }
        }
      });
      
      console.log(`Allocating seats for ${combinedPassengers.length} passengers`);
      return allocateSeats(combinedPassengers);
    } catch (error) {
      console.error('Error in seat allocation:', error);
      return new Array(seatLabels.length).fill(null);
    }
  }, [allPassengers, passengerData]);

  return (
    <div className="confirmation-container">
      <h2 className="confirmation-title">🪑 Seat Map 🪑</h2>
      <InfoBox />
      <div className="plane-body">
        <div className="washroom-row"><div className="washroom-seat">🚻</div></div>

        {Array.from({ length: 20 }, (_, rowIdx) => {
          const row = rowIdx + 1;
          const rowSeats = assignedSeats
            .filter((s, index) => seatLabels[index].row === row)
            .map((passenger, index) => ({
              ...seatLabels[(row-1) * 6 + index],
              ...passenger,
              empty: !passenger
            }));

          return (
            <React.Fragment key={row}>
              {row === 11 && (
                <div className="exit-row">
                  <div className="exit-label">🚪 EMERGENCY EXIT</div>
                </div>
              )}

              <div className="seat-row">
                <div className="seat-group">
                  {rowSeats.slice(0, 3).map((seat) => (
                    <div
                      key={seat.label}
                      className={`seat-box ${
                        seat.empty
                          ? "empty"
                          : seat.travelType === "family"
                          ? "family"
                          : "solo"
                      }`}
                      style={{
                        backgroundColor: seat.familyColor || (seat.travelType === "family" ? "#FFB7B2" : undefined),
                        color: seat.familyColor ? "#000" : undefined
                      }}
                      title={`Seat ${seat.seatNumber}${seat.isNearToilet ? " - Near Toilet" : ""}${seat.isEmergencyExit ? " - Emergency Exit" : ""}`}
                    >
                      <div className="seat-label">{seat.seatNumber}</div>
                      {!seat.empty && (
                        <>
                          <div className="passenger-name">{seat.name}</div>
                          {seat.disability === "Yes" && (
                            <div className="disability-symbol">♿</div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="aisle" />

                <div className="seat-group">
                  {rowSeats.slice(3).map((seat) => (
                    <div
                      key={seat.label}
                      className={`seat-box ${
                        seat.empty
                          ? "empty"
                          : seat.travelType === "family"
                          ? "family"
                          : "solo"
                      }`}
                      style={{
                        backgroundColor: seat.familyColor || (seat.travelType === "family" ? "#FFB7B2" : undefined),
                        color: seat.familyColor ? "#000" : undefined
                      }}
                      title={`Seat ${seat.seatNumber}${seat.isNearToilet ? " - Near Toilet" : ""}${seat.isEmergencyExit ? " - Emergency Exit" : ""}`}
                    >
                      <div className="seat-label">{seat.seatNumber}</div>
                      {!seat.empty && (
                        <>
                          <div className="passenger-name">{seat.name}</div>
                          {seat.disability === "Yes" && (
                            <div className="disability-symbol">♿</div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        <div className="washroom-row"><div className="washroom-seat">🚻</div></div>
      </div>
    </div>
  );
};

export default SeatMapPage;